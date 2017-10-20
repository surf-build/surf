import {spawn} from 'spawn-rx';
import {Observable, Scheduler, Subject, Subscription, Observer} from 'rxjs';
import { IScheduler } from 'rxjs/Scheduler';

import SerialSubscription from 'rxjs-serial-subscription';

import {getNwoFromRepoUrl} from './github-api';

import './custom-rx-operators';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-monitor');

export function getSeenRefs(refs: [any]): Set<string> {
  return refs.reduce((acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set<string>());
}

interface CurrentBuild {
  observable: Observable<string | {}>;
  cancel: (() => void);
}

export default class BuildMonitor {
  private readonly currentBuilds = new Map<string, CurrentBuild>();
  private readonly scheduler: IScheduler;
  private readonly currentRunningMonitor = new SerialSubscription();
  private readonly buildsToActuallyExecute = new Subject<Observable<string | {}>>();
  private readonly seenCommits = new Set<string>();

  public readonly buildMonitorCrashed = new Subject<Error>();

  constructor(
      private cmdWithArgs: string[],
      private repo: string,
      private maxConcurrentJobs: number,
      private fetchRefs: (() => Observable<[any]>),
      initialRefs?: [any],
      scheduler?: IScheduler,
      private pollInterval = 5000) {

    this.scheduler = scheduler || Scheduler.queue;
    this.currentRunningMonitor = new SerialSubscription();
    this.buildsToActuallyExecute = new Subject();
    this.buildMonitorCrashed = new Subject();

    this.buildMonitorCrashed.subscribe((e) => {
      console.error(`Build Monitor crashed! ${e.message}`);
      console.error(e.stack);

      this.unsubscribe();
    });

    if (initialRefs) {
      this.seenCommits = getSeenRefs(initialRefs);
    } else {
      this.seenCommits = new Set();
    }
  }

  unsubscribe() {
    this.currentRunningMonitor.unsubscribe();
  }

  runBuild(ref: any) {
    let args = this.cmdWithArgs.slice(1).concat([ref.object.sha]);
    let envToAdd: any = {
      'SURF_SHA1': ref.object.sha,
      'SURF_REPO': this.repo,
      'SURF_NWO': getNwoFromRepoUrl(this.repo),
      'SURF_REF': ref.ref.replace(/^refs\/heads\//, '')
    };

    if (ref.object.pr) {
      envToAdd.SURF_PR_NUM = ref.object.pr.number;
    }

    let opts = {
      env: Object.assign({}, envToAdd, process.env)
    };

    d(`About to run: ${this.cmdWithArgs[0]} ${args.join(' ')}`);
    console.log(`Building ${this.repo}@${ref.object.sha} (${ref.ref})`);

    return spawn(this.cmdWithArgs[0], args, opts)
      .do((x) => console.log(x), e => console.error(e));
  }

  getOrCreateBuild(ref: any) {
    let ret = this.currentBuilds[ref.object.sha];
    if (ret) return ret;

    d(`Queuing build for SHA: ${ref.object.sha}, ${ref.ref}`);
    let cs = new Subject();
    let cancel = () => cs.next(true);

    let innerObs = this.runBuild(ref)
      .takeUntil(cs)
      .publishLast();

    innerObs.catch(() => Observable.of(''))
      .subscribe(() => {
        d(`Removing ${ref.object.sha} from active builds`);
        delete this.currentBuilds[ref.object.sha];
      });

    let connected: Subscription;
    let buildObs = Observable.create((subj: Observer<string | {}>) => {
      this.seenCommits.add(ref.object.sha);

      let disp = innerObs.subscribe(subj);
      if (!connected) connected = innerObs.connect();

      return disp;
    });

    return this.currentBuilds[ref.object.sha] = { observable: buildObs, cancel };
  }

  start() {
    let fetchCurrentRefs = Observable.interval(this.pollInterval, this.scheduler)
      .switchMap(() => this.fetchRefs());

    let disp = this.buildsToActuallyExecute
      .map((x) => x.delayFailures(4000).catch((e) => {

        console.log(e.message.replace(/[\r\n]+$/, ''));
        d(e.stack);

        return Observable.empty();
      }))
      .mergeAll(this.maxConcurrentJobs)
      .subscribe(() => {}, (e) => this.buildMonitorCrashed.next(e));

    let disp2 = fetchCurrentRefs.subscribe((refs) => {
      let seenRefs = getSeenRefs(refs);

      // Cancel any builds that are out-of-date
      let cancellers = Array.from(this.currentBuilds.keys()).reduce((acc,x) => {
        if (seenRefs.has(x)) return acc;

        acc.push(this.currentBuilds.get(x)!.cancel);
        return acc;
      }, new Array<() => void>());

      // NB: We intentionally collect all of these via the reducer first to avoid
      // altering currentBuilds while iterating through it
      cancellers.forEach((x) => x());

      let refsToBuild = this.determineRefsToBuild(refs);

      // NB: If we don't do this, we can stack overflow if the build queue
      // gets too deep
      Observable.from(refsToBuild)
        .observeOn(this.scheduler)
        .subscribe((x) =>
          this.buildsToActuallyExecute.next(this.getOrCreateBuild(x).observable));
    }, (e) => this.buildMonitorCrashed.next(e));

    let newSub = new Subscription();
    newSub.add(disp);  newSub.add(disp2);

    this.currentRunningMonitor.add(newSub);
    return newSub;
  }

  determineRefsToBuild(refInfo: [any]) {
    let dedupe = new Set();

    return refInfo.filter((ref) => {
      if (this.seenCommits.has(ref.object.sha)) return false;
      if (dedupe.has(ref.object.sha)) return false;

      dedupe.add(ref.object.sha);
      return true;
    });
  }
}