import request from 'request-promise';
import {Observable} from 'rxjs';

import {getOriginForRepo} from './git-api';
import {fetchAllRefsWithInfo, getSanitizedRepoUrl, getNwoFromRepoUrl} from './github-api';
import createRefServer from './ref-server-api';
import ON_DEATH from 'death';

import BuildMonitor from './build-monitor';
import './custom-rx-operators';

const d = require('debug')('surf:run-on-every-ref');

const DeathPromise = new Promise((res,rej) => {
  ON_DEATH((sig) => rej(new Error(`Signal ${sig} thrown`)));
});

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default async function main(argv, showHelp) {
  let cmdWithArgs = argv._;
  let repo = argv.r;
  let server = argv.s;
  
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
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error("--jobs must be an integer");
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
  let buildMonitor = new BuildMonitor(cmdWithArgs, repo, jobs, () => fetchRefsWithRetry, refInfo);
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
