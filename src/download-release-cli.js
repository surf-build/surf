#!/usr/bin/env node

import './babel-maybefill';
import main from './download-release-main';

const d = require('debug')('surf:surf-download');

const yargs = require('yargs')
  .usage(`Usage: surf-download -r http://github.com/some/repo -t some-tag
Download all of the artifacts for a given Release`)
  .alias('r', 'repo')
  .describe('repo', 'The repository to clone')
  .alias('t', 'tag')
  .describe('tag', 'The tag to download releases for')
  .describe('target', 'The directory to download files to')
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
