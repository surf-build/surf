import _ from 'lodash';
import determineChangedRefs from './ref-differ';
import {spawn} from './promise-array';
import {Observable, Scheduler, Disposable, SerialDisposable} from 'rx';

const d = require('debug')('serf:build-monitor');

export function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

export default class BuildMonitor {
  constructor(cmdWithArgs, maxConcurrentJobs, fetchRefs, initialRefs=null, scheduler=null) {
    _.assign(this, {cmdWithArgs, maxConcurrentJobs, fetchRefs, scheduler});

    this.currentBuilds = {};
    this.scheduler = this.scheduler || Scheduler.default;
    this.currentRunningMonitor = new SerialDisposable();

    if (initialRefs) {
      this.seenCommits = getSeenRefs(initialRefs);
    } else {
      this.seenCommits = new Set();
    }
  }

  dispose() {
    this.currentRunningMonitor.dispose();
  }

  runBuild(cmdWithArgs, ref, repo) {
    let args = _.clone(cmdWithArgs).splice(1).concat([ref.object.sha]);
    let envToAdd = {
      'SERF_SHA1': ref.object.sha,
      'SERF_REPO': repo
    };

    let opts = {
      env: _.assign({}, envToAdd, process.env)
    };

    d(`About to run: ${cmdWithArgs[0]} ${args.join(' ')}`);
    return spawn(cmdWithArgs[0], args, opts)
      .do((x) => console.log(x), e => console.error(e))
      .publishLast()
      .refCount();
  }

  getOrCreateBuild(cmdWithArgs, ref, repo) {
    let ret = this.currentBuilds[ref.object.sha];
    if (ret) return ret;

    d(`Queuing build for SHA: ${ref.object.sha}`);
    ret = this.currentBuilds[ref.object.sha] = this.runBuild(cmdWithArgs, ref, repo)
      .finally(() => delete this.currentBuilds[ref.object.sha]);

    return ret;
  }

  start() {
    this.currentRunningMonitor.setDisposable(Disposable.empty);

    let previousRefs = {};
    let changedRefs = Observable.interval(5*1000, this.scheduler)
      .flatMap(() => this.fetchRefs())
      .map((currentRefs) => determineChangedRefs(this.seenCommits, previousRefs, currentRefs));

    let disp = changedRefs
      .map((changedRefs) => {
        previousRefs = _.clone(changedRefs);

        d(`Found changed refs: ${JSON.stringify(_.map(changedRefs, (x) => x.ref))}`);
        return Observable.fromArray(changedRefs)
          .map((ref) => this.getOrCreateBuild(this.cmdWithArgs, ref, this.repo))
          .merge(this.maxConcurrentJobs)
          .reduce((acc) => acc, null);
      })
      .switch()
      .subscribe();

    this.currentRunningMonitor.setDisposable(disp);
    return disp;
  }
}
