#!/usr/bin/env node

import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';
import chalk from 'chalk';

import {asyncMap} from './promise-array';
import {getOriginForRepo} from './git-api';
import {getNwoFromRepoUrl, getCommitStatusesForRef} from './github-api';
import createRefServer from './ref-server-api';

const d = require('debug')('surf:commit-status-cli');

const yargs = require('yargs')
  .usage(`Usage: surf-status --repo https://github.com/owner/repo
Returns the GitHub Status for all the branches in a repo`)
  .alias('s', 'server')
  .describe('s', 'The Surf server to connect to - use this if you call surf-status repeatedly')  .help('h')
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to fetch status for. Defaults to the repo in the current directory')
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
  let refList = _.map(refInfo, (x) => x.ref);
  let statuses = await asyncMap(refList, (ref) => getCommitStatusesForRef(nwo, ref));

  if (jsonOnly) {
    let statusArr = _.map(refList, (x) => statuses[x].result);
    console.log(JSON.stringify(statusArr));
  } else {
    const statusToIcon = {
      'success': chalk.green('✓'),
      'failure': chalk.red('✘'),
      'error': chalk.red('✘'),
      'pending': chalk.yellow('‽')
    };

    _.each(refList, (ref) => {
      let status = statuses[ref].result;
      if (status.total_count < 1) return;

      if (status.total_count === 1) {
        console.log(`${statusToIcon[status.state]}: ${ref} - ${status.description || '(No description)'} - ${status.target_url || '(No CI URL given)'}`);
      } else {
        console.log(`${statusToIcon[status.state]}: ${ref}`);
        _.each(status.statuses, (status) => {
          console.log(`  ${status.description} - ${status.target_url}`);
        });
      }
    });
  }

  killRefServer.dispose();
}

main()
  .then(() => process.exit(0), (e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
