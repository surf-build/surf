#!/usr/bin/env node

import main from './clean-workdirs-main';
import * as path from 'path';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:surf-clean');

// tslint:disable-next-line:no-var-requires
const yargs = require('yargs')
  .usage(`Usage: surf-clean -r https://github.com/owner/repo
Cleans builds that no longer correspond to any active ref`)
  .help('h')
  .boolean('dry-run')
  .describe('dry-run', 'If set, report the directories we would delete')
  .alias('r', 'repo')
  .describe('r', 'The repository URL to remove old builds for')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help');

const argv = yargs.argv;

if (argv.version) {
  // tslint:disable-next-line:no-var-requires
  let pkgJson = require(path.join(__dirname, '..', 'package.json'));
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
