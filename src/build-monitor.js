import _ from 'lodash';
import {spawn} from './promise-array';
import {Observable, Scheduler, Disposable, SerialDisposable} from 'rx';
import './custom-rx-operators';

const d = require('debug')('serf:build-monitor');

export function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

export default class BuildMonitor {
  constructor(cmdWithArgs, maxConcurrentJobs, fetchRefs, initialRefs=null, scheduler=null, pollInterval=5000) {
    _.assign(this, {cmdWithArgs, maxConcurrentJobs, fetchRefs, scheduler, pollInterval});

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
      .do((x) => console.log(x), e => console.error(e));
  }

  determineRefsToBuild(refInfo) {
    let dedupe = new Set();
  
    return _.filter(refInfo, (ref) => {
      if (this.seenCommits.has(ref.object.sha)) return false;
      if (dedupe.has(ref.object.sha)) return false;
      
      dedupe.add(ref.object.sha);
      d(`wtf: ${ref.object.sha}`);
      return true;
    });
  }

  getOrCreateBuild(cmdWithArgs, ref, repo) {
    let ret = this.currentBuilds[ref.object.sha];
    if (ret) return ret.obs;

    d(`Queuing build for SHA: ${ref.object.sha}, ${ref.ref}`);
    let buildObs = this.runBuild(cmdWithArgs, ref, repo)
      .subUnsub(() => {
        this.currentBuilds[ref.object.sha] = { obs: buildObs, disp: buildObs.subscribe() };
      }, () => {
        this.currentBuilds[ref.object.sha].disp.dispose();
        delete this.currentBuilds[ref.object.sha];
      })
      .do(() => 
        this.seenCommits.add(ref.object.sha), () => this.seenCommits.add(ref.object.sha))
      .publishLast()
      .refCount();

    this.currentBuilds[ref.object.sha] = { obs: buildObs, disp: Disposable.empty };
    return buildObs;
  }

  start() {
    this.currentRunningMonitor.setDisposable(Disposable.empty);

    let changedRefs = Observable.interval(this.pollInterval, this.scheduler)
      .flatMap(() => this.fetchRefs())
      .map((currentRefs) => this.determineRefsToBuild(currentRefs));

    let disp = changedRefs
      .map((changedRefs) => {
        d(`Found changed refs: ${JSON.stringify(_.map(changedRefs, (x) => x.ref))}`);

        return Observable.fromArray(changedRefs)
          .map((ref) => this.getOrCreateBuild(this.cmdWithArgs, ref, this.repo))
          .merge(this.maxConcurrentJobs);
      })
      .switch()
      .subscribe();

    this.currentRunningMonitor.setDisposable(disp);
    return disp;
  }
}
