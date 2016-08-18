#!/usr/bin/env node

import './babel-maybefill';
import main from './publish-tag-main';

const d = require('debug')('surf:surf-publish');

const yargs = require('yargs')
  .usage(`Usage: surf-publish -r http://github.com/some/repo -t some-tag
Creates a release for the given tag by downloading all of the build 
artifacts and reuploading them`)
  .alias('r', 'repo')
  .describe('repo', 'The repository to clone')
  .alias('t', 'tag')
  .describe('tag', 'The tag to download releases for')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.
GIST_TOKEN - the GitHub (.com or Enterprise) API token to use to clone the build Gists.
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
