#!/usr/bin/env node

import main from './job-installer-main';

const d = require('debug')('surf:surf-install');

const yargs = require('yargs')
  .usage(`Usage: surf-install -n my-cool-job -c "surf-client ..."
Creates a system service with the given command (probably surf-client) as its
executable. Run using sudo. 

Surf-specific environment variables (e.g. GITHUB_TOKEN) will be captured 
automatically, but others can be explicitly specified at the command line`)
  .alias('n', 'name')
  .describe('name', 'The name given to the OS of the service to create')
  .alias('c', 'command')
  .describe('command', 'The command to run, usually surf-client')
  .describe('environment', 'A comma-separated list of environment variables to include in the service')
  .describe('dry-run', 'Instead of creating a service, display the configuration file and exit')
  .alias('t', 'type')
  .describe('type', 'Explicitly choose the type of service to create, usually "-t docker" for Docker')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('e', 'environment')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use.
GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to (optionally) post status to.
GIST_ENTERPRISE_URL - the GitHub Enterprise URL to (optionally) post Gists to.
GIST_TOKEN - the GitHub (.com or Enterprise) API token to use to create the build output Gist.
`);

const argv = yargs.argv;

if (argv.version) {
  let pkgJson = require('../package.json');
  console.log(`Surf ${pkgJson.version}`);
  process.exit(0);
}

main(argv, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });
