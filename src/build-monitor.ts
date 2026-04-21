import {
  EMPTY,
  from,
  interval,
  Observable,
  type Observer,
  queueScheduler,
  type SchedulerLike,
  Subject,
  Subscription,
} from "rxjs";
import {
  catchError,
  finalize,
  map,
  mergeAll,
  observeOn,
  share,
  switchMap,
  takeUntil,
  tap,
} from "rxjs/operators";
import { spawn } from "spawn-rx";
import { delayFailures } from "./custom-rx-operators";
import { getNwoFromRepoUrl } from "./github-api";

// tslint:disable-next-line:no-var-requires
const d = require("debug")("surf:build-monitor");

export function getSeenRefs(refs: any[]): Set<string> {
  return refs.reduce((acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set<string>());
}

interface CurrentBuild {
  observable: Observable<string>;
  cancel: () => void;
}

export default class BuildMonitor {
  private readonly currentBuilds = new Map<string, CurrentBuild>();
  private readonly scheduler: SchedulerLike;
  private readonly currentRunningMonitor = new Subscription();
  private readonly buildsToActuallyExecute = new Subject<Observable<string>>();
  public seenCommits = new Set<string>();

  public readonly buildMonitorCrashed = new Subject<Error>();

  constructor(
    private cmdWithArgs: string[],
    private repo: string,
    private maxConcurrentJobs: number,
    public fetchRefs: () => Observable<any[]>,
    initialRefs?: any[],
    scheduler?: SchedulerLike,
    public pollInterval = 5000,
    private enableCancellation = true,
  ) {
    this.scheduler = scheduler || queueScheduler;
    this.currentRunningMonitor = new Subscription();
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

  runBuild(ref: any): Observable<string> {
    const args = this.cmdWithArgs.slice(1).concat([ref.object.sha]);
    const envToAdd: any = {
      SURF_SHA1: ref.object.sha,
      SURF_REPO: this.repo,
      SURF_NWO: getNwoFromRepoUrl(this.repo),
      SURF_REF: ref.ref.replace(/^refs\/heads\//, ""),
    };

    if (ref.object.pr) {
      envToAdd.SURF_PR_NUM = ref.object.pr.number;
    }

    const opts = {
      env: Object.assign({}, envToAdd, process.env),
    };

    d(`About to run: ${this.cmdWithArgs[0]} ${args.join(" ")}`);
    console.log(`Building ${this.repo}@${ref.object.sha} (${ref.ref})`);

    return spawn(this.cmdWithArgs[0], args, { ...opts, split: false }).pipe(
      tap({
        next: (output) => console.log(output),
        error: (error) => console.error(error),
      }),
    );
  }

  getOrCreateBuild(ref: any) {
    const ret = this.currentBuilds.get(ref.object.sha);
    if (ret) return ret;

    d(`Queuing build for SHA: ${ref.object.sha}, ${ref.ref}`);
    this.seenCommits.add(ref.object.sha);
    const cs = new Subject<void>();
    const cancel = () => cs.next();
    const innerObs = this.runBuild(ref).pipe(
      takeUntil(cs),
      finalize(() => {
        d(`Removing ${ref.object.sha} from active builds`);
        this.currentBuilds.delete(ref.object.sha);
      }),
      share(),
    );

    const buildObs = new Observable<string>((subj: Observer<string>) =>
      innerObs.subscribe(subj),
    );

    const currentBuild = { observable: buildObs, cancel };
    this.currentBuilds.set(ref.object.sha, currentBuild);
    return currentBuild;
  }

  start() {
    const fetchCurrentRefs = interval(this.pollInterval, this.scheduler).pipe(
      switchMap(() => this.fetchRefs()),
    );

    const disp = this.buildsToActuallyExecute
      .pipe(
        map((build) =>
          delayFailures(build, 4000).pipe(
            catchError((e) => {
              console.log(e.message.replace(/[\r\n]+$/, ""));
              d(e.stack);
              return EMPTY;
            }),
          ),
        ),
        mergeAll(this.maxConcurrentJobs),
      )
      .subscribe(
        () => {},
        (e) => this.buildMonitorCrashed.next(e),
      );

    const disp2 = fetchCurrentRefs.subscribe(
      (refs) => {
        const seenRefs = getSeenRefs(refs);

        // Cancel any builds that are out-of-date
        const cancellers = Array.from(this.currentBuilds.keys()).reduce(
          (acc, x) => {
            if (seenRefs.has(x)) return acc;

            acc.push(this.currentBuilds.get(x)!.cancel);
            return acc;
          },
          [] as (() => void)[],
        );

        // NB: We intentionally collect all of these via the reducer first to avoid
        // altering currentBuilds while iterating through it
        if (this.enableCancellation) {
          cancellers.forEach((x) => {
            x();
          });
        }

        const refsToBuild = this.determineRefsToBuild(refs);

        // NB: If we don't do this, we can stack overflow if the build queue
        // gets too deep
        from(refsToBuild)
          .pipe(observeOn(this.scheduler))
          .subscribe((x) =>
            this.buildsToActuallyExecute.next(
              this.getOrCreateBuild(x).observable,
            ),
          );
      },
      (e) => this.buildMonitorCrashed.next(e),
    );

    const newSub = new Subscription();
    newSub.add(disp);
    newSub.add(disp2);

    this.currentRunningMonitor.add(newSub);
    return newSub;
  }

  determineRefsToBuild(refInfo: any[]) {
    const dedupe = new Set();

    return refInfo.filter((ref) => {
      if (this.seenCommits.has(ref.object.sha)) return false;
      if (dedupe.has(ref.object.sha)) return false;

      dedupe.add(ref.object.sha);
      return true;
    });
  }
}
