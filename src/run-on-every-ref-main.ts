import onDeath from 'death'
import createDebug from 'debug'
import { defer, from, lastValueFrom, merge } from 'rxjs'
import { delay, retry, take } from 'rxjs/operators'
import BuildMonitor from './build-monitor'
import { delayFailures } from './custom-rx-operators'
import { getOriginForRepo } from './git-api'
import { fetchAllRefsWithInfo, getNwoFromRepoUrl, getSanitizedRepoUrl } from './github-api'

const d = createDebug('surf:run-on-every-ref')

const DeathPromise = new Promise<number>((_res, rej) => {
  onDeath((sig: number) => rej(new Error(`Signal ${sig} thrown`)))
})

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export default async function main(argv: any, showHelp: () => void) {
  let cmdWithArgs = argv._
  let repo = argv.r
  const enableCancellation = !argv['no-cancel']

  if (argv.help) {
    showHelp()
    process.exit(0)
  }

  if (cmdWithArgs.length < 1) {
    console.log("Command to run not specified, defaulting to 'surf-build'")
    cmdWithArgs = ['surf-build', '-n', 'surf']
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'))
      console.error(`Repository not specified, using current directory: ${repo}`)
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo')
      d(e.stack)

      showHelp()
      process.exit(-1)
    }
  }

  const jobs = parseInt(argv.j || '2', 10)
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error('--jobs must be an integer')
    showHelp()
    process.exit(-1)
  }

  // Do an initial fetch to get our initial state
  let refInfo: any[] = []
  const fetchRefs = () => fetchAllRefsWithInfo(getNwoFromRepoUrl(repo))

  const fetchRefsWithRetry = defer(() => delayFailures(from(fetchRefs()), getRandomInt(1000, 6000))).pipe(retry(5))

  refInfo = await lastValueFrom(fetchRefsWithRetry)

  console.log(`Watching ${repo}, will run '${cmdWithArgs.join(' ')}'\n`)
  const buildMonitor = new BuildMonitor(
    cmdWithArgs,
    repo,
    jobs,
    () => fetchRefsWithRetry,
    refInfo,
    undefined,
    undefined,
    enableCancellation
  )
  buildMonitor.start()

  // NB: This is a little weird - buildMonitorCrashed just returns an item
  // whereas DeathPromise actually throws
  const ex = await lastValueFrom(merge(buildMonitor.buildMonitorCrashed.pipe(delay(5000), take(1)), from(DeathPromise)))

  if (ex) throw ex

  // NB: We will never get here in normal operation
  return true
}
