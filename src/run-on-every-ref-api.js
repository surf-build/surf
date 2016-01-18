import _ from 'lodash';
import determineChangedRefs from './ref-differ';
import {spawn} from './promise-array';
import {Observable, Scheduler} from 'rx';

const d = require('debug')('serf:run-on-every-ref');

export class ExecuteOnEveryRef {
  constructor(cmdWithArgs, maxConcurrentJobs, fetchRefs, scheduler=null) {
    _.assign(this, {cmdWithArgs, maxConcurrentJobs, fetchRefs, scheduler});

    this.currentBuilds = {};
    this.seenCommits = new Set();
    this.scheduler = this.scheduler || Scheduler.default;
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

  getOrCreateBuild(cmdWithArgs, ref, repo) {
    let ret = this.currentBuilds[ref.object.sha];
    if (ret) return ret;

    d(`Queuing build for SHA: ${ref.object.sha}`);
    ret = this.currentBuilds[ref.object.sha] = this.runBuild(cmdWithArgs, ref, repo)
      .finally(() => delete this.currentBuilds[ref.object.sha]);

    return ret;
  }

  start() {
    return Observable.interval(5*1000, this.scheduler)
      .flatMap(() => this.fetchRefs())
      .map((currentRefs) => determineChangedRefs(this.seenCommits, currentRefs))
      .map((changedRefs) => {
        return Observable.fromArray(changedRefs)
          .map((ref) => this.getOrCreateBuild(this.cmdWithArgs, ref, this.repo))
          .merge(this.maxConcurrentJobs)
          .reduce((acc) => acc, null);
      })
      .switch()
      .subscribe();
  }
}
