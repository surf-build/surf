#!/usr/bin/env node

import main from './run-on-every-ref-main';

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
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use instead of .com.
GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.`);

const argv = yargs.argv;

if (argv.version) {
  let pkgJson = require('../package.json');
  console.log(`Surf ${pkgJson.version}`);
  process.exit(0);
}

main(argv, () => yargs.showHelp())
  .catch((e) => {
    console.error(e.message);
    d(e.stack);
    process.exit(-1);
  });
