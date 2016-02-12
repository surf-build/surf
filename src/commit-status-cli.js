#!/usr/bin/env node

import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';

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
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

SURF_PORT - the port to serve on if not specified via -p, defaults to 3000.
GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.

SURF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by surf-client.`);

const argv = yargs.argv;

async function main(testRepo=null, testServer=null) {
  let repo = testRepo || argv.r || process.env.SURF_REPO;
  let server = testServer || argv.s;

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

  let refList = _.map(await fetchRefs(), (x) => x.ref);
  let statuses = await asyncMap(refList, (ref) => getCommitStatusesForRef(nwo, ref));

  let statusArr = _.map(refList, (x) => statuses[x]);
  console.log(JSON.stringify(statusArr));

  killRefServer.dispose();
}

main()
  .then(() => process.exit(0), (e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
