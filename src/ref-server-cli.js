#!/usr/bin/env node

import './babel-maybefill';
import createRefServer from './ref-server-api';

const d = require('debug')('surf:ref-server');

const yargs = require('yargs')
  .usage(`Usage: surf-server owner/repo owner2/repo owner/repo3...
Runs a web service to monitor GitHub commits and provide them to Surf clients`)
  .help('h')
  .alias('p', 'port')
  .describe('p', 'The port to start the server on')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

SURF_PORT - the port to serve on if not specified via -p, defaults to 3000.
GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.`);

const argv = yargs.argv;

function main() {
  if (argv.help) {
    yargs.showHelp();
    process.exit(0);
  }
  
  
  const validNwos = argv._;
  const port = argv.port || process.env.SURF_PORT || '3000';

  if (validNwos.length < 1) {
    console.error("ERROR: Supply a list of valid repositories in owner/repo format (i.e. 'rails/rails')\n");
    yargs.showHelp();
    process.exit(-1);
  }

  console.log(`Listening on port ${port}`);
  try {
    createRefServer(validNwos, port);
  } catch (e) {
    console.error(`Failed to create Surf server: ${e.message}`);
    d(e.stack);
  }
}

main();
