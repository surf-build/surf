import _ from 'lodash';
import path from 'path';
import {fs} from '../src/promisify';
import BuildMonitor from '../src/build-monitor';
import {Observable, TestScheduler, Disposable} from 'rx';

const d = require('debug')('serf-test:build-monitor');

function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

describe('the build monitor', function() {
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
    this.fixture = new BuildMonitor(null, 2, null, null, this.sched);
  });

  afterEach(function() {
    this.fixture.dispose();
  });

  it('should decide to build new refs from a blank slate', function() {
    this.fixture.fetchRefs = () =>
      Observable.just(this.refExamples['refs1.json']);

    let buildCount = 0;
    this.fixture.runBuild = () => {
      buildCount++;
      return Observable.just('');
    };

    this.fixture.start();
    expect(buildCount).to.equal(0);

    this.sched.advanceBy(30*1000);
    expect(buildCount).to.equal(10);
  });

  it('should decide to build only changed refs', function() {
    this.fixture.fetchRefs = () =>
      Observable.just(this.refExamples['refs1.json']);

    let buildCount = 0;
    this.fixture.runBuild = () => {
      buildCount++;
      return Observable.just('');
    };

    this.fixture.start();
    expect(buildCount).to.equal(0);

    this.sched.advanceBy(this.fixture.pollInterval + 1000);
    expect(buildCount).to.equal(10);

    this.fixture.fetchRefs = () =>
      Observable.just(this.refExamples['refs2.json']);

    // Move to the next interval, we should only run the one build
    this.sched.advanceBy(this.fixture.pollInterval);
    expect(buildCount).to.equal(11);
  });

  it('should only build at a max level of concurrency', function() {
    let buildRequests = 0;
    let liveBuilds = 0;

    this.fixture.runBuild = (cmdWithArgs, ref) => {
      buildRequests++;

      return Observable.just('')
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
    };

    this.fixture.fetchRefs = () =>
      Observable.just(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1000);

    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);
    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(1000);
    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);
    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(30 * 1000);
    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);
    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(0);
  });

  it.only('shouldnt cancel any builds when we only look at one set of refs', function() {
    let buildRequests = 0;
    let liveBuilds = 0;
    let cancelledRefs = [];

    this.fixture.runBuild = (cmdWithArgs, ref) => {
      buildRequests++;

      let ret = Observable.just('')
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

        return Disposable.create(() => {
          disp.dispose();
          if (producedItem) return;

          d(`Canceled ref before it finished! ${ref.object.sha}`);
          liveBuilds--;
          cancelledRefs.push(ref.object.sha);
        });
      });
    };

    this.fixture.fetchRefs = () =>
      Observable.just(this.refExamples['refs1.json']);

    this.fixture.start();
    this.sched.advanceBy(this.fixture.pollInterval + 1000);

    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);
    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(1000);
    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);
    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(2);

    this.sched.advanceBy(30 * 1000);
    d(`liveBuilds: ${liveBuilds}, buildRequests: ${buildRequests}`);

    expect(buildRequests).to.equal(10);
    expect(liveBuilds).to.equal(0);
    expect(cancelledRefs.length).to.equal(0);
  });
});
