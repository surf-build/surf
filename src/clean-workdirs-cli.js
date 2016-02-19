#!/usr/bin/env node

import './babel-maybefill';
import main from './clean-workdirs-main';

const d = require('debug')('surf:surf-clean');

const yargs = require('yargs')
  .usage(`Usage: surf-clean -s http://some.server -r https://github.com/owner/repo
Cleans builds that no longer correspond to any active ref`)
  .help('h')
  .alias('s', 'server')
  .describe('s', 'The Surf server to connect to')
  .boolean('dry-run')
  .describe('dry-run', 'If set, report the directories we would delete')
  .alias('r', 'repo')
  .describe('r', 'The repository URL to remove old builds for')
  .alias('h', 'help');
  
const argv = yargs.argv;

main(argv, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  });
