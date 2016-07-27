import _ from 'lodash';
import {spawn} from './promise-array';
import {Observable, Scheduler, CompositeDisposable, SerialDisposable, Subject} from 'rx';
import {getNwoFromRepoUrl} from './github-api';

import './custom-rx-operators';

const d = require('debug')('surf:build-monitor');

export function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

export default class BuildMonitor {
  constructor(cmdWithArgs, repo, maxConcurrentJobs, fetchRefs, initialRefs=null, scheduler=null, pollInterval=5000) {
    _.assign(this, {cmdWithArgs, maxConcurrentJobs, fetchRefs, scheduler, pollInterval, repo});

    this.currentBuilds = {};
    this.scheduler = this.scheduler || Scheduler.default;
    this.currentRunningMonitor = new SerialDisposable();
    this.buildsToActuallyExecute = new Subject();
    this.buildMonitorCrashed = new Subject();
    
    this.buildMonitorCrashed.subscribe((e) => {
      console.error(`Build Monitor crashed! ${e.message}`);
      console.error(e.stack);
    
      this.dispose();
    });

    if (initialRefs) {
      this.seenCommits = getSeenRefs(initialRefs);
    } else {
      this.seenCommits = new Set();
    }
  }

  dispose() {
    this.currentRunningMonitor.dispose();
  }

  runBuild(ref) {
    let args = _.clone(this.cmdWithArgs).splice(1).concat([ref.object.sha]);
    let envToAdd = {
      'SURF_SHA1': ref.object.sha,
      'SURF_REPO': this.repo,
      'SURF_NWO': getNwoFromRepoUrl(this.repo),
      'SURF_REF': ref.ref.replace(/^refs\/heads\//, '')
    };
    
    if (ref.object.pr) {
      envToAdd.SURF_PR_NUM = ref.object.pr.number;
    }

    let opts = {
      env: _.assign({}, envToAdd, process.env)
    };

    d(`About to run: ${this.cmdWithArgs[0]} ${args.join(' ')}`);
    console.log(`Building ${this.repo}@${ref.object.sha} (${ref.ref})`);

    return spawn(this.cmdWithArgs[0], args, opts)
      .do((x) => console.log(x), e => console.error(e));
  }

  getOrCreateBuild(ref) {
    let ret = this.currentBuilds[ref.object.sha];
    if (ret) return ret;

    d(`Queuing build for SHA: ${ref.object.sha}, ${ref.ref}`);
    let cs = new Subject();
    let cancel = () => cs.onNext(true);

    let innerObs = this.runBuild(ref)
      .takeUntil(cs)
      .publishLast();

    innerObs.catch(() => Observable.just(''))
      .subscribe(() => {
        d(`Removing ${ref.object.sha} from active builds`);
        delete this.currentBuilds[ref.object.sha];
      });

    let connected = null;
    let buildObs = Observable.create((subj) => {
      this.seenCommits.add(ref.object.sha);

      let disp = innerObs.subscribe(subj);
      if (!connected) connected = innerObs.connect();

      return disp;
    });

    return this.currentBuilds[ref.object.sha] = { observable: buildObs, cancel };
  }

  determineRefsToBuild(refInfo) {
    let dedupe = new Set();

    return _.filter(refInfo, (ref) => {
      if (this.seenCommits.has(ref.object.sha)) return false;
      if (dedupe.has(ref.object.sha)) return false;

      dedupe.add(ref.object.sha);
      return true;
    });
  }

  start() {
    let fetchCurrentRefs = Observable.interval(this.pollInterval, this.scheduler)
      .flatMap(() => this.fetchRefs());

    let disp = this.buildsToActuallyExecute
      .map((x) => x.delayFailures(4000).catch((e) => {
      
        console.log(e.message.replace(/[\r\n]+$/, ''));
        d(e.stack);

        return Observable.empty();
      }))
      .merge(this.maxConcurrentJobs)
      .subscribe(() => {}, (e) => this.buildMonitorCrashed.onNext(e));

    let disp2 = fetchCurrentRefs.subscribe((refs) => {
      let seenRefs = getSeenRefs(refs);

      // Cancel any builds that are out-of-date
      let cancellers = _.reduce(Object.keys(this.currentBuilds), (acc,x) => {
        if (seenRefs.has(x)) return acc;

        acc.push(this.currentBuilds[x].cancel);
        return acc;
      }, []);

      // NB: We intentionally collect all of these via the reducer first to avoid
      // altering currentBuilds while iterating through it
      _.each(cancellers, (x) => x());

      let refsToBuild = this.determineRefsToBuild(refs);
      
      _.each(refsToBuild, (ref) => {
        // NB: If we don't do this, we can stack overflow if the build queue
        // gets too deep
        this.scheduler.schedule(null, 
          () => this.buildsToActuallyExecute.onNext(this.getOrCreateBuild(ref).observable));
      });
    }, (e) => this.buildMonitorCrashed.onNext(e));

    this.currentRunningMonitor.setDisposable(new CompositeDisposable(disp, disp2));
    return disp;
  }
}
