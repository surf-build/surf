import * as fs from 'node:fs'
import * as path from 'node:path'
import type JobInstallerBase from './job-installer-base'
import { asyncReduce } from './promise-array'

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:job-installer-api')

export function createJobInstallers() {
  const discoverClasses = fs.readdirSync(path.join(__dirname, 'job-installers'))

  return discoverClasses
    .filter((x) => x.match(/\.[jt]s$/i) && !x.match(/\.d\.ts$/i))
    .map((x) => {
      const Klass = require(path.join(__dirname, 'job-installers', x)).default

      d(`Found job installer: ${Klass.name}`)
      return new Klass() as JobInstallerBase
    })
}

export async function getDefaultJobInstallerForPlatform(name: string, command: string) {
  const ret = await asyncReduce(
    createJobInstallers(),
    async (acc, installer) => {
      const affinity = await installer.getAffinityForJob(name, command)

      if (affinity < 1) return acc
      if (!acc) return { affinity, installer }

      return acc.affinity >= affinity ? acc : { affinity, installer }
    },
    null as { affinity: number; installer: JobInstallerBase } | null
  )

  const installer = ret ? ret.installer : null

  if (!installer) {
    const names = createJobInstallers().map((x) => x.getName())
    throw new Error(
      `Can't find a compatible job installer for your platform - available types are - ${names.join(', ')}`
    )
  }

  return installer
}

export async function installJob(
  name: string,
  command: string,
  returnContent = false,
  explicitType?: string,
  extraEnvVars?: string[]
) {
  let installer: JobInstallerBase | null = null

  if (explicitType) {
    installer = createJobInstallers().find((x) => x.getName() === explicitType) || null

    if (!installer) {
      const names = createJobInstallers().map((x) => x.getName())

      throw new Error(`Couldn't find job installer with name ${explicitType} - available types are ${names.join(', ')}`)
    }
  } else {
    installer = await getDefaultJobInstallerForPlatform(name, command)
  }

  if (!installer) {
    throw new Error(`Couldn't determine a job installer for ${name}`)
  }

  if (extraEnvVars) installer.setExtraEnvVars(extraEnvVars)
  return await installer.installJob(name, command, returnContent)
}
