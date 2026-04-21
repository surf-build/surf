#!/usr/bin/env node

import createDebug from 'debug'
import yargsFactory from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkgJson from '../package.json' with { type: 'json' }
import main from './commit-status-main'

const d = createDebug('surf:surf-status')
const yargs = yargsFactory(hideBin(process.argv))
  .exitProcess(false)
  .usage(`Usage: surf-status --repo https://github.com/owner/repo
Returns the GitHub Status for all the branches in a repo`)
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to fetch status for. Defaults to the repo in the current directory')
  .boolean('j')
  .alias('j', 'json')
  .describe('j', 'Dump the commit status in JSON format for machine parsing instead of human-readable format')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.

SURF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by surf.`)

const argv = yargs.parseSync() as {
  r?: string
  repo?: string
  j?: boolean
  help?: boolean
  version?: boolean
}

if (argv.help) {
  process.exit(0)
}

if (argv.version) {
  console.log(`Surf ${pkgJson.version}`)
  process.exit(0)
}

main(argv.r ?? argv.repo, argv.j, argv.help, () => yargs.showHelp())
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`)
    d(e.stack)

    process.exit(-1)
  })
