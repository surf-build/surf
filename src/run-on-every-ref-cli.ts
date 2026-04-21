#!/usr/bin/env node

import createDebug from 'debug'
import yargsFactory from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkgJson from '../package.json' with { type: 'json' }
import main from './run-on-every-ref-main'

const d = createDebug('surf:surf')
const yargs = yargsFactory(hideBin(process.argv))
  .exitProcess(false)
  .usage(`Usage: surf-run -r https://github.com/some/repo -- command arg1 arg2 arg3...
Monitors a GitHub repo and runs a command for each changed branch / PR.`)
  .help('h')
  .alias('r', 'repo')
  .describe('r', 'The URL of the repository to monitor. Defaults to the repo in the current directory')
  .alias('j', 'jobs')
  .describe('j', 'The number of concurrent jobs to run. Defaults to 2')
  .alias('v', 'version')
  .describe('version', 'Print the current version number and exit')
  .alias('h', 'help')
  .describe('no-cancel', 'Disable build cancellation - new pushes will not abort in-progress builds')
  .boolean('no-cancel')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to use instead of .com.
GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.`)

const argv = yargs.parseSync()

if (argv.help) {
  process.exit(0)
}

if (argv.version) {
  console.log(`Surf ${pkgJson.version}`)
  process.exit(0)
}

main(argv, () => yargs.showHelp()).catch((e) => {
  console.error(e.message)
  d(e.stack)
  process.exit(-1)
})
