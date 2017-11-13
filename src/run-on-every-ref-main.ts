import {Observable} from 'rxjs';

import {getOriginForRepo} from './git-api';
import {fetchAllRefsWithInfo, getSanitizedRepoUrl, getNwoFromRepoUrl} from './github-api';
import * as ON_DEATH from 'death';

import BuildMonitor from './build-monitor';
import './custom-rx-operators';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:run-on-every-ref');

const DeathPromise = new Promise<number>((_res,rej) => {
  ON_DEATH((sig: number) => rej(new Error(`Signal ${sig} thrown`)));
});

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default async function main(argv: any, showHelp: () => void) {
  let cmdWithArgs = argv._;
  let repo = argv.r;
  let enableCancellation = !argv['no-cancel'];

  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (cmdWithArgs.length < 1) {
    console.log("Command to run not specified, defaulting to 'surf-build'");
    cmdWithArgs = ['surf-build', '-n', 'surf'];
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
      console.error(`Repository not specified, using current directory: ${repo}`);
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo');
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error('--jobs must be an integer');
    showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;
  let fetchRefs = () => fetchAllRefsWithInfo(getNwoFromRepoUrl(repo));

  let fetchRefsWithRetry = Observable.defer(() =>
    Observable.fromPromise(fetchRefs())
      .delayFailures(getRandomInt(1000, 6000)))
    .retry(5);

  refInfo = await fetchRefsWithRetry.toPromise();

  console.log(`Watching ${repo}, will run '${cmdWithArgs.join(' ')}'\n`);
  let buildMonitor = new BuildMonitor(cmdWithArgs, repo, jobs, () => fetchRefsWithRetry, refInfo, undefined, undefined, enableCancellation);
  buildMonitor.start();

  // NB: This is a little weird - buildMonitorCrashed just returns an item
  // whereas DeathPromise actually throws
  let ex = await (Observable.merge(
    buildMonitor.buildMonitorCrashed.delay(5000).take(1),
    Observable.fromPromise(DeathPromise)
  ).toPromise());

  if (ex) throw ex;

  // NB: We will never get here in normal operation
  return true;
}
