#!/usr/bin/env node

const d = require('debug')('surf:surf-status');

import main from './commit-status-main';

const yargs = require('yargs')
  .usage(`Usage: surf-status --repo https://github.com/owner/repo
Returns the GitHub Status for all the branches in a repo`)
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to fetch status for. Defaults to the repo in the current directory')
  .boolean('j')
  .alias('j', 'json')
  .describe('j', 'Dump the commit status in JSON format for machine parsing instead of human-readable format')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.

SURF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by surf.`);

const argv = yargs.argv;

if (argv.version) {
  let pkgJson = require('../package.json');
  console.log(`Surf ${pkgJson.version}`);
  process.exit(0);
}

main(argv.r, argv.s, argv.j, argv.help, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });
