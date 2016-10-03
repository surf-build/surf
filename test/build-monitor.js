import _ from 'lodash';
import path from 'path';
import {fs} from '../src/promisify';
import BuildMonitor from '../src/build-monitor';
import {Observable, Subscription, Subject} from 'rxjs';
import {TestScheduler} from '@kwonoj/rxjs-testscheduler-compat';

import '../src/custom-rx-operators';

const d = require('debug')('surf-test:build-monitor');

function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

describe.only('the build monitor', function() {
  beforeEach(async function() {
    let acc = {};
    let fixturesDir = path.join(__dirname, '..', 'fixtures');

    for (let name of await fs.readdir(fixturesDir)) {
      if (!name.match(/^refs.*\.json$/i)) continue;

      let contents = await fs.readFile(path.join(fixturesDir, name), 'utf8');
      acc[name] = JSON.parse(contents.split('\n')[0]);
    }

    this.refExamples = acc;

    this.sched = new TestScheduler();
    this.fixture = new BuildMonitor(null, null, 2, null, null, this.sched);
  });

  afterEach(function() {
    this.fixture.unsubscribe();
  });

  it('shouldnt run builds in getOrCreateBuild until you subscribe', function() {
    let buildCount = 0;
    let runBuildCount = 0;

    // Scheduling is live
    this.sched.advanceBy(1000);

    let buildSubject = new Subject();
    this.fixture.runBuild = () => {
      runBuildCount++;
      return buildSubject.subUnsub(() => buildCount++);
    };

    d('Initial getOrCreateBuild');
    let ref = this.refExamples['refs1.json'][1];
    let result = this.fixture.getOrCreateBuild(ref);
    this.sched.advanceBy(1000);
    expect(buildCount).to.equal(0);
    expect(runBuildCount).to.equal(1);

    d('Subscribing 1x');
    result.observable.subscribe();
    this.sched.advanceBy(1000);
    expect(buildCount).to.equal(1);

    // Double subscribes do nothing
    d('Subscribing 2x');
    result.observable.subscribe();
    this.sched.advanceBy(1000);
    expect(buildCount).to.equal(1);

    d('Second getOrCreateBuild');
    result = this.fixture.getOrCreateBuild(ref);
    result.observable.subscribe();
    this.sched.advanceBy(1000);
    expect(buildCount).to.equal(1);
    expect(runBuildCount).to.equal(1);

    d('Complete the build');
    buildSubject.next('');
    buildSubject.complete();

    d('Third getOrCreateBuild');
    result = this.fixture.getOrCreateBuild(ref);
    result.observable.subscribe();
    this.sched.advanceBy(1000);

    expect(buildCount).to.equal(2);
    expect(runBuildCount).to.equal(2);
  });

  it('should decide to build new refs from a blank slate', function() {
    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    let buildCount = 0;
    this.fixture.runBuild = () => {
      buildCount++;
      return Observable.of('');
    };

    this.fixture.start();
    expect(buildCount).to.equal(0);

    this.sched.advanceBy(30*1000);
    expect(buildCount).to.equal(10);
  });

  it('should decide to build only changed refs', function() {
    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    let buildCount = 0;
    this.fixture.runBuild = (ref) => {
      buildCount++;
      return Observable.of('')
        .subUnsub(() => d(`Building ${ref.object.sha}`));
    };

    this.fixture.start();
    expect(buildCount).to.equal(0);

    this.sched.advanceBy(this.fixture.pollInterval + 1000);
    expect(buildCount).to.equal(10);

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs2.json']);

    // Move to the next interval, we should only run the one build
    this.sched.advanceBy(this.fixture.pollInterval);
    expect(buildCount).to.equal(11);
  });

  it('should only build at a max level of concurrency', function() {
    let liveBuilds = 0;
    let completedBuilds = 0;
    let completedShas = new Set();

    this.fixture.runBuild = (ref) => {
      return Observable.of('')
        .do(() => {
          if (completedShas.has(ref.object.sha)) d(`Double building! ${ref.object.sha}`);
          liveBuilds++;
          d(`Starting build: ${ref.object.sha}`);
        })
        .delay(2*1000, this.sched)
        .do(() => {}, () => {}, () => {
          liveBuilds--;
          completedBuilds++;
          completedShas.add(ref.object.sha);
          d(`Completing build: ${ref.object.sha}`);
        })
        .publish()
        .refCount();
    };

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 2);

    expect(liveBuilds).to.equal(2);
    expect(completedBuilds).to.equal(0);

    this.sched.advanceBy(this.fixture.pollInterval);
    expect(liveBuilds).to.equal(2);
    expect(completedBuilds).to.equal(4);  // two builds per 2sec, for 5sec

    this.sched.advanceBy(30 * 1000);
    expect(liveBuilds).to.equal(0);
    expect(completedBuilds).to.equal(10);
  });

  it('shouldnt cancel any builds when we only look at one set of refs', function() {
    let liveBuilds = 0;
    let cancelledRefs = [];

    this.fixture.runBuild = (ref) => {
      let ret = Observable.of('')
        .do(() => {
          liveBuilds++;
          d(`Starting build: ${ref.object.sha}`);
        })
        .delay(2*1000, this.sched)
        .do(() => {}, () => {}, () => {
          liveBuilds--;
          d(`Completing build: ${ref.object.sha}`);
        })
        .publish()
        .refCount();

      return Observable.create((subj) => {
        let producedItem = false;
        let disp = ret
          .do(() => producedItem = true)
          .subscribe(subj);

        return new Subscription(() => {
          disp.unsubscribe();
          if (producedItem) return;

          d(`Canceled ref before it finished! ${ref.object.sha}`);
          liveBuilds--;
          cancelledRefs.push(ref.object.sha);
        });
      });
    };

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1000);

    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(1000);
    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(30 * 1000);

    expect(liveBuilds).to.equal(0);
    expect(cancelledRefs.length).to.equal(0);
  });

  it('should cancel builds when their refs disappear', function() {
    let liveBuilds = 0;
    let cancelledRefs = [];

    this.fixture.runBuild = (ref) => {
      let ret = Observable.of('')
        .do(() => {
          liveBuilds++;
          d(`Starting build: ${ref.object.sha}`);
        })
        .delay(10*1000, this.sched)
        .do(() => {}, () => {}, () => {
          liveBuilds--;
          d(`Completing build: ${ref.object.sha}`);
        })
        .publish()
        .refCount();

      return Observable.create((subj) => {
        let producedItem = false;
        let disp = ret
          .do(() => producedItem = true)
          .subscribe(subj);

        return new Subscription(() => {
          disp.unsubscribe();
          if (producedItem) return;

          d(`Canceled ref before it finished! ${ref.object.sha}`);
          liveBuilds--;
          cancelledRefs.push(ref.object.sha);
        });
      });
    };

    this.fixture.seenCommits = getSeenRefs(this.refExamples['refs1.json']);

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs3.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1000);

    expect(liveBuilds).to.equal(2);

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs4.json']);

    this.sched.advanceBy(this.fixture.pollInterval + 1000);
    expect(liveBuilds).to.equal(1);
  });

  it('should cancel builds when their refs change', function() {
    let liveBuilds = 0;
    let cancelledRefs = [];

    this.fixture.runBuild = (ref) => {
      let ret = Observable.of('')
        .do(() => {
          liveBuilds++;
          d(`Starting build: ${ref.object.sha}`);
        })
        .delay(10*1000, this.sched)
        .do(() => {}, () => {}, () => {
          liveBuilds--;
          d(`Completing build: ${ref.object.sha}`);
        })
        .publish()
        .refCount();

      return Observable.create((subj) => {
        let producedItem = false;
        let disp = ret
          .do(() => producedItem = true)
          .subscribe(subj);

        return new Subscription(() => {
          disp.unsubscribe();
          if (producedItem) return;

          d(`Canceled ref before it finished! ${ref.object.sha}`);
          liveBuilds--;
          cancelledRefs.push(ref.object.sha);
        });
      });
    };

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1000);
    expect(liveBuilds).to.equal(2);

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs2.json']);

    this.sched.advanceBy(this.fixture.pollInterval + 1000);
    expect(liveBuilds).to.equal(2);
  });

  it('shouldnt die when builds fail', function() {
    this.fixture.runBuild = () => Observable.throw(new Error("no"));

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1);

    let ranBuild = false;
    this.fixture.runBuild = () => {
      ranBuild = true;
      return Observable.of('');
    };

    this.fixture.fetchRefs = () =>
      Observable.of(this.refExamples['refs2.json']);

    this.sched.advanceBy(this.fixture.pollInterval);

    expect(ranBuild).to.be.ok;
  });
});
