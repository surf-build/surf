#!/usr/bin/env node

import './babel-maybefill';

import request from 'request-promise';
import {getOriginForRepo} from './git-api';
import {getNwoFromRepoUrl} from './github-api';
import createRefServer from './ref-server-api';
import BuildMonitor from './build-monitor';

const d = require('debug')('surf:run-on-every-ref');

const yargs = require('yargs')
  .usage(`Usage: surf-client -r https://github.com/some/repo -- command arg1 arg2 arg3...
Monitors a GitHub repo and runs a command for each changed branch / PR.`)
  .help('h')
  .alias('s', 'server')
  .describe('s', 'The Surf server to connect to for multi-machine builds')
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to monitor. Defaults to the repo in the current directory')
  .alias('j', 'jobs')
  .describe('j', 'The number of concurrent jobs to run. Defaults to 2')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use instead of .com.
GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.`);

const argv = yargs.argv;

async function main(testServer=null, testRepo=null, testCmdWithArgs=null) {
  let cmdWithArgs = testCmdWithArgs || argv._;
  let repo = testRepo || argv.r;
  let server = testServer || argv.s;

  if (cmdWithArgs.length < 1) {
    console.log("Command to run not specified, defaulting to 'surf-build'");
    cmdWithArgs = ['surf-build', '-n', 'surf'];
  }

  if (!repo) {
    try {
      repo = await getOriginForRepo('.');
      console.error(`Repository not specified, using current directory: ${repo}`);
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      yargs.showHelp();
      process.exit(-1);
    }
  }

  if (!server) {
    console.error(`
**** Becoming a Surf Server ****

If you're only setting up a single build client, this is probably what you want.
If you're setting up more than one, you'll want to run 'surf-server' somewhere,
then pass '-s' to all of your build clients.`);

    let nwo = getNwoFromRepoUrl(repo);
    createRefServer([nwo]);

    server = `http://localhost:${process.env.SURF_PORT || 3000}`;
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error("--jobs must be an integer");
    yargs.showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;
  let nwo = getNwoFromRepoUrl(repo);
  let surfUrl = `${server}/info/${nwo}`;

  const fetchRefs = async () => {
    try {
      return await request({
        uri: surfUrl,
        json: true
      });
    } catch (e) {
      console.log(`Failed to fetch from ${surfUrl}: ${e.message}`);
      d(e.stack);
      process.exit(-1);
    }
  };

  refInfo = await fetchRefs();

  // TODO: figure out a way to trap Ctrl-C and dispose stop
  console.log(`Watching ${repo}, will run '${cmdWithArgs.join(' ')}'\n`);
  let buildMonitor = new BuildMonitor(cmdWithArgs, repo, jobs, fetchRefs, refInfo);
  buildMonitor.start();

  return new Promise(() => {});
}

main()
  .catch((e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
