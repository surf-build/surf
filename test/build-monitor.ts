import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Observable, of, Subject, Subscription, throwError, VirtualTimeScheduler } from 'rxjs'
import { delay, share, tap } from 'rxjs/operators'
import BuildMonitor from '../src/build-monitor'
import { subUnsub } from '../src/custom-rx-operators'

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf-test:build-monitor')

function getSeenRefs(refs: any[]) {
  return refs.reduce((acc, x) => {
    acc.add(x.object.sha)
    return acc
  }, new Set<string>())
}

class AdvancingScheduler extends VirtualTimeScheduler {
  advanceBy(ms: number) {
    this.maxFrames = this.frame + ms
    this.flush()
  }
}

describe('the build monitor', () => {
  let refExamples: Record<string, any[]> = {}
  let sched: AdvancingScheduler
  let fixture: BuildMonitor

  beforeEach(async () => {
    const acc: Record<string, any[]> = {}
    const fixturesDir = path.join(__dirname, '..', 'fixtures')

    for (const name of await readdir(fixturesDir)) {
      if (!name.match(/^refs.*\.json$/i)) continue

      const contents = await readFile(path.join(fixturesDir, name), 'utf8')
      acc[name] = JSON.parse(contents.split('\n')[0])
    }

    refExamples = acc
    sched = new AdvancingScheduler()
    fixture = new BuildMonitor([], '', 2, () => throwError(() => new Error('no')), undefined, sched as any)
  })

  afterEach(() => {
    fixture.unsubscribe()
  })

  it('shouldnt run builds in getOrCreateBuild until you subscribe', () => {
    let buildCount = 0
    let runBuildCount = 0

    // Scheduling is live
    sched.advanceBy(1000)

    const buildSubject = new Subject<string>()
    fixture.runBuild = () => {
      runBuildCount++
      return subUnsub(buildSubject, () => buildCount++)
    }

    d('Initial getOrCreateBuild')
    const ref = refExamples['refs1.json'][1]
    let result = fixture.getOrCreateBuild(ref)
    sched.advanceBy(1000)
    expect(buildCount).toBe(0)
    expect(runBuildCount).toBe(1)

    d('Subscribing 1x')
    result.observable.subscribe()
    sched.advanceBy(1000)
    expect(buildCount).toBe(1)

    // Double subscribes do nothing
    d('Subscribing 2x')
    result.observable.subscribe()
    sched.advanceBy(1000)
    expect(buildCount).toBe(1)

    d('Second getOrCreateBuild')
    result = fixture.getOrCreateBuild(ref)
    result.observable.subscribe()
    sched.advanceBy(1000)
    expect(buildCount).toBe(1)
    expect(runBuildCount).toBe(1)

    d('Complete the build')
    buildSubject.next('')
    buildSubject.complete()

    d('Third getOrCreateBuild')
    result = fixture.getOrCreateBuild(ref)
    result.observable.subscribe()
    sched.advanceBy(1000)

    expect(buildCount).toBe(2)
    expect(runBuildCount).toBe(2)
  })

  it('should decide to build new refs from a blank slate', () => {
    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    let buildCount = 0
    fixture.runBuild = () => {
      buildCount++
      return of('')
    }

    fixture.start()
    expect(buildCount).toBe(0)

    sched.advanceBy(30 * 1000)
    expect(buildCount).toBe(10)
  })

  it('should decide to build only changed refs', () => {
    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    let buildCount = 0
    fixture.runBuild = (ref: any) => {
      buildCount++
      return subUnsub(of(''), () => d(`Building ${ref.object.sha}`))
    }

    fixture.start()
    expect(buildCount).toBe(0)

    sched.advanceBy(fixture.pollInterval + 1000)
    expect(buildCount).toBe(10)

    fixture.fetchRefs = () => of(refExamples['refs2.json'])

    // Move to the next interval, we should only run the one build
    sched.advanceBy(fixture.pollInterval)
    expect(buildCount).toBe(11)
  })

  it('should only build at a max level of concurrency', () => {
    let liveBuilds = 0
    let completedBuilds = 0
    const completedShas = new Set<string>()

    fixture.runBuild = (ref: any) => {
      return of('').pipe(
        tap(() => {
          if (completedShas.has(ref.object.sha)) d(`Double building! ${ref.object.sha}`)
          liveBuilds++
          d(`Starting build: ${ref.object.sha}`)
        }),
        delay(2 * 1000, sched),
        tap({
          complete: () => {
            liveBuilds--
            completedBuilds++
            completedShas.add(ref.object.sha)
            d(`Completing build: ${ref.object.sha}`)
          },
        }),
        share()
      )
    }

    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    fixture.start()
    sched.advanceBy(fixture.pollInterval + 2)

    expect(liveBuilds).toBe(2)
    expect(completedBuilds).toBe(0)

    sched.advanceBy(fixture.pollInterval)
    expect(liveBuilds).toBe(2)
    expect(completedBuilds).toBe(4)

    sched.advanceBy(30 * 1000)
    expect(liveBuilds).toBe(0)
    expect(completedBuilds).toBe(10)
  })

  it('shouldnt cancel any builds when we only look at one set of refs', () => {
    let liveBuilds = 0
    const cancelledRefs: string[] = []

    fixture.runBuild = (ref: any) => {
      const ret = of('').pipe(
        tap(() => {
          liveBuilds++
          d(`Starting build: ${ref.object.sha}`)
        }),
        delay(2 * 1000, sched),
        tap({
          complete: () => {
            liveBuilds--
            d(`Completing build: ${ref.object.sha}`)
          },
        }),
        share()
      )

      return new Observable((subj) => {
        let producedItem = false
        const disp = ret.pipe(tap(() => (producedItem = true))).subscribe(subj)

        return new Subscription(() => {
          disp.unsubscribe()
          if (producedItem) return

          d(`Canceled ref before it finished! ${ref.object.sha}`)
          liveBuilds--
          cancelledRefs.push(ref.object.sha)
        })
      })
    }

    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    fixture.start()
    sched.advanceBy(fixture.pollInterval + 1000)

    expect(liveBuilds).toBe(2)

    sched.advanceBy(1000)
    expect(liveBuilds).toBe(2)

    sched.advanceBy(30 * 1000)

    expect(liveBuilds).toBe(0)
    expect(cancelledRefs.length).toBe(0)
  })

  it.skip('should cancel builds when their refs disappear', () => {
    let liveBuilds = 0
    const cancelledRefs: string[] = []

    fixture.runBuild = (ref: any) => {
      const ret = of('').pipe(
        tap(() => {
          liveBuilds++
          d(`Starting build: ${ref.object.sha}`)
        }),
        delay(10 * fixture.pollInterval, sched),
        tap({
          complete: () => {
            liveBuilds--
            d(`Completing build: ${ref.object.sha}`)
          },
        }),
        share()
      )

      return new Observable((subj) => {
        let producedItem = false
        const disp = ret.pipe(tap(() => (producedItem = true))).subscribe(subj)

        return new Subscription(() => {
          disp.unsubscribe()
          if (producedItem) return

          d(`Canceled ref before it finished! ${ref.object.sha}`)
          liveBuilds--
          cancelledRefs.push(ref.object.sha)
        })
      })
    }

    fixture.seenCommits = getSeenRefs(refExamples['refs1.json'])

    fixture.fetchRefs = () => of(refExamples['refs3.json'])

    fixture.start()
    sched.advanceBy(fixture.pollInterval + 1000)

    expect(liveBuilds).toBe(2)

    fixture.fetchRefs = () => of(refExamples['refs4.json'])

    sched.advanceBy(fixture.pollInterval + 1000)
    expect(liveBuilds).toBe(1)
  })

  it('should cancel builds when their refs change', () => {
    let liveBuilds = 0
    const cancelledRefs: string[] = []

    fixture.runBuild = (ref: any) => {
      const ret = of('').pipe(
        tap(() => {
          liveBuilds++
          d(`Starting build: ${ref.object.sha}`)
        }),
        delay(10 * 1000, sched),
        tap({
          complete: () => {
            liveBuilds--
            d(`Completing build: ${ref.object.sha}`)
          },
        }),
        share()
      )

      return new Observable((subj) => {
        let producedItem = false
        const disp = ret.pipe(tap(() => (producedItem = true))).subscribe(subj)

        return new Subscription(() => {
          disp.unsubscribe()
          if (producedItem) return

          d(`Canceled ref before it finished! ${ref.object.sha}`)
          liveBuilds--
          cancelledRefs.push(ref.object.sha)
        })
      })
    }

    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    fixture.start()
    sched.advanceBy(fixture.pollInterval + 1000)
    expect(liveBuilds).toBe(2)

    fixture.fetchRefs = () => of(refExamples['refs2.json'])

    sched.advanceBy(fixture.pollInterval + 1000)
    expect(liveBuilds).toBe(2)
  })

  it('shouldnt die when builds fail', () => {
    fixture.runBuild = () => throwError(() => new Error('no'))

    fixture.fetchRefs = () => of(refExamples['refs1.json'])

    fixture.start()
    sched.advanceBy(fixture.pollInterval + 1)

    let ranBuild = false
    fixture.runBuild = () => {
      ranBuild = true
      return of('')
    }

    fixture.fetchRefs = () => of(refExamples['refs2.json'])

    sched.advanceBy(fixture.pollInterval)

    expect(ranBuild).toBe(true)
  })
})
