import { installJob } from './job-installer-api'

export default async function main(argv: any, showHelp: () => void) {
  if (!argv.n || !argv.c) {
    console.error('You must specify both name and command')
    showHelp()

    process.exit(-1)
  }

  const extraEnvs = argv.environment ? argv.environment.split(',') : null
  const result = await installJob(argv.name, argv.command, argv['dry-run'], argv.type, extraEnvs)

  if (!argv['dry-run']) {
    console.log(result)
    return
  }

  if (Object.keys(result).length < 2) {
    for (const file in result) {
      console.log(result[file])
    }
  } else {
    for (const file in result) {
      console.log(`${file}:\n`)
      console.log(result[file])
    }
  }
}
