#!/usr/bin/env node

import './babel-maybefill';
import main from './delete-old-gists-main';

const d = require('debug')('surf:surf-download');

const yargs = require('yargs')
  .usage(`Usage: surf-delete-that-shit
Download all of the artifacts for a given Release`)
  .epilog(`
Some useful environment variables:

GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.
`);

const argv = yargs.argv;

main(argv, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    process.exit(-1);
  });
