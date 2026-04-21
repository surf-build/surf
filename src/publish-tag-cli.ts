#!/usr/bin/env node

import createDebug from 'debug'
import yargsFactory from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkgJson from '../package.json' with { type: 'json' }
import main from './publish-tag-main'

const d = createDebug('surf:surf-publish')
const yargs = yargsFactory(hideBin(process.argv))
  .exitProcess(false)
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
`)

const argv = yargs.parseSync()

if (argv.help) {
  process.exit(0)
}

if (argv.version) {
  console.log(`Surf ${pkgJson.version}`)
  process.exit(0)
}

main(argv, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`)
    d(e.stack)

    process.exit(-1)
  })
