#!/usr/bin/env node

import * as path from 'path';

import { getOriginForRepo, getHeadForRepo } from './git-api';
import { getSanitizedRepoUrl, getNwoFromRepoUrl, findPRForCommit } from './github-api';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:surf-publish');

// tslint:disable-next-line:no-var-requires
const yargs = require('yargs')
  .usage(`Usage: surf-sha-to-tag -r http://github.com/some/repo -s some-sha1
Returns the PR number for a given SHA1
`)
  .alias('r', 'repo')
  .describe('repo', 'The repository to clone')
  .alias('s', 'sha')
  .describe('sha', 'The sha to build')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('t', 'type')
  .describe('type', 'What to return, either "url", "number", or "json"')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use instead of .com.
GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.
`);

const argv = yargs.argv;

if (argv.version) {
  // tslint:disable-next-line:no-var-requires
  let pkgJson = require(path.join(__dirname, '..', 'package.json'));
  console.log(`Surf ${pkgJson.version}`);
  process.exit(0);
}

async function main(argv: any, showHelp: (() => void)) {
  let sha = argv.sha || process.env.SURF_SHA1;
  let repo = argv.repo || process.env.SURF_REPO;

  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
      argv.repo = repo;
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo');
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  if (!repo) {
    showHelp();
    process.exit(-1);
  }

  if (!sha) {
    d(`SHA1 not specified, trying to retrieve default branch`);
    try {
      sha = await getHeadForRepo('.');
      argv.sha = sha;
      d(`Default branch is ${sha}`);
    } catch (e) {
      console.error(`Failed to find the current commit for repo ${repo}: ${e.message}`);
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  let nwo = getNwoFromRepoUrl(repo);
  let pr = await findPRForCommit(nwo, sha);
  if (!pr) process.exit(-1);

  let type = argv.t || 'number';
  switch (type) {
  case 'number':
    console.log(pr.number);
    return;
  case 'url':
    console.log(pr.url);
    return;
  case 'json':
    console.log(JSON.stringify(pr, null, 2));
    return;
  default:
    throw new Error('Invalid type!');
  }
}

main(argv, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });
