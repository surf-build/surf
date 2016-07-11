#!/usr/bin/env node

import './babel-maybefill';
import main from './commit-status-main';

const d = require('debug')('surf:surf-publish');

const yargs = require('yargs')
  .usage(`Usage: surf-status --repo https://github.com/owner/repo
Returns the GitHub Status for all the branches in a repo`)
  .alias('s', 'server')
  .describe('s', 'The Surf server to connect to - use this if you call surf-status repeatedly')  .help('h')
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to fetch status for. Defaults to the repo in the current directory')
  .boolean('j')
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

main(argv.r, argv.s, argv.j, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });
