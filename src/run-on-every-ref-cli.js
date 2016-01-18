#!/usr/bin/env node

import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';
import determineChangedRefs from './ref-differ';
import {asyncMap, delay, spawn} from './promise-array';
import {getNwoFromRepoUrl} from './github-api';
import {Observable} from 'rx';

const d = require('debug')('serf:run-on-every-ref');

const yargs = require('yargs')
  .usage(`Usage: serf-client -s http://some.server -r https://github.com/some/repo -- command arg1 arg2 arg3...
Monitors a GitHub repo and runs a command for each changed branch / PR.`)
  .help('h')
  .alias('s', 'server')
  .describe('s', 'The Serf server to connect to')
  .alias('r', 'repository')
  .describe('r', 'The URL of the repository to monitor')
  .alias('j', 'jobs')
  .describe('j', 'The number of concurrent jobs to run. Defaults to 2')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.`);

const argv = yargs.argv;

function runBuild(cmdWithArgs, ref, repo) {
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

async function main() {
  const cmdWithArgs = argv._;

  if (cmdWithArgs.length < 1) {
    yargs.showHelp();
    process.exit(-1);
  }

  if (!argv.s || !argv.r) {
    yargs.showHelp();
    process.exit(-1);
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error("--jobs must be an integer");
    yargs.showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;
  let nwo = getNwoFromRepoUrl(argv.r);
  let serfUrl = `${argv.s}/info/${nwo}`;

  const fetchRefs = async () => {
    try {
      return await request({
        uri: serfUrl,
        json: true
      });
    } catch (e) {
      console.log(`Failed to fetch from ${serfUrl}: ${e.message}`);
      d(e.stack);
      process.exit(-1);
    }
  };

  refInfo = await fetchRefs();

  // All refs on startup are seen refs
  let seenCommits = _.reduce(refInfo, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());

  let stop = Observable.interval(5*1000)
    .flatMap(() => fetchRefs())
    .flatMap((currentRefs) =>
      Observable.fromArray(determineChangedRefs(seenCommits, currentRefs)))
    .map((ref) => {
      d(`Building ref ${ref}...`);
      return runBuild(cmdWithArgs, ref, argv.r)
        .catch((e) => { console.error(e.message); return Observable.empty(); });
    })
    .merge(jobs)
    .subscribe();
}

main()
  .catch((e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
