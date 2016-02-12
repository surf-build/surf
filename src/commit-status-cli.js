#!/usr/bin/env node

import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';
import chalk from 'chalk';

import {asyncMap} from './promise-array';
import {getOriginForRepo} from './git-api';
import {getNwoFromRepoUrl, getCommitStatusesForRef, determineInterestingRefs} from './github-api';
import createRefServer from './ref-server-api';

const d = require('debug')('surf:commit-status-cli');

const yargs = require('yargs')
  .usage(`Usage: surf-status --repo https://github.com/owner/repo
Returns the GitHub Status for all the branches in a repo`)
  .alias('s', 'server')
  .describe('s', 'The Surf server to connect to - use this if you call surf-status repeatedly')  .help('h')
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to fetch status for. Defaults to the repo in the current directory')
  .alias('c', 'closed')
  .describe('c', 'Show commit status for closed PRs as well')
  .alias('j', 'json')
  .describe('j', 'Dump the commit status in JSON format for machine parsing instead of human-readable format')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

SURF_PORT - the port to serve on if not specified via -p, defaults to 3000.
GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.

SURF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by surf-client.`);

const argv = yargs.argv;

async function main(testRepo=null, testServer=null, useJson=null) {
  let repo = testRepo || argv.r || process.env.SURF_REPO;
  let server = testServer || argv.s;
  let jsonOnly = useJson || argv.j;
  let closedPrs = argv.c;

  if (!repo) {
    try {
      repo = await getOriginForRepo('.');
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      yargs.showHelp();
      process.exit(-1);
    }
  }

  let killRefServer = null;
  if (!server) {
    let nwo = getNwoFromRepoUrl(repo);
    killRefServer = createRefServer([nwo]);
    server = `http://localhost:${process.env.SURF_PORT || 3000}`;
  }

  d(`Getting nwo for ${repo}`);
  let nwo = getNwoFromRepoUrl(repo);
  let surfUrl = `${server}/info/${nwo}`;

  const fetchRefs = async () => {
    return await request({
      uri: surfUrl,
      json: true
    });
  };

  let refInfo = await fetchRefs();
  let refList = determineInterestingRefs(refInfo);
  let statuses = await asyncMap(
    _.map(refList, (x) => x.ref),
    (ref) => {
      if (ref.pr && ref.pr.state !== 'open' && !closedPrs) return Promise.resolve(null);
      return getCommitStatusesForRef(nwo, ref);
    });

  d(`Interesting Refs: ${JSON.stringify(_.map(refList, (x) => x.ref))}`);
  if (jsonOnly) {
    let statusArr = _.map(refList, (x) => statuses[x.ref].result);
    console.log(JSON.stringify(statusArr));
  } else {
    const statusToIcon = {
      'success': chalk.green('✓'),
      'failure': chalk.red('✘'),
      'error': chalk.red('✘'),
      'pending': chalk.yellow('‽')
    };

    console.log(`Commit Status Information for ${repo}\n`);
    for (let ref of refList) {
      //d(`Looking at ${ref.ref}...`);
      let status = statuses[ref.ref].result;

      // Ignore closed PRs
      if (ref.pr && ref.pr.state !== 'open' && !closedPrs) continue;

      let friendlyName = ref.pr ?
        `#${ref.pr.number} (${ref.pr.title})` :
        `${ref.ref.replace('refs/heads/', '')}`;

      if (status.total_count === 0) {
        console.log(`${statusToIcon['pending']}: ${friendlyName} - no commit status for this branch / PR`);
        continue;
      }

      if (status.total_count === 1) {
        d(JSON.stringify(status));
        console.log(`${statusToIcon[status.state]}: ${friendlyName} - ${status.statuses[0].description || '(No description)'} - ${status.statuses[0].target_url || '(No CI URL given)'}`);
        continue;
      }

      console.log(`${statusToIcon[status.state]}: ${friendlyName}`);
      _.each(status.statuses, (status) => {
        console.log(`  ${status.description} - ${status.target_url}`);
      });
    }
  }

  killRefServer.dispose();
}

main()
  .then(() => process.exit(0), (e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
