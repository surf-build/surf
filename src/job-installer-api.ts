import createDebug from 'debug'
import type JobInstallerBase from './job-installer-base'
import DockerInstaller from './job-installers/docker'
import LaunchdInstaller from './job-installers/launchd'
import SystemdInstaller from './job-installers/systemd'
import TaskSchedulerInstaller from './job-installers/task-scheduler'
import { asyncReduce } from './promise-array'

const d = createDebug('surf:job-installer-api')

const INSTALLER_CLASSES = [
  DockerInstaller,
  LaunchdInstaller,
  SystemdInstaller,
  TaskSchedulerInstaller,
] as (new () => JobInstallerBase)[]

export function createJobInstallers() {
  return INSTALLER_CLASSES.map((Klass) => {
    d(`Found job installer: ${Klass.name}`)
    return new Klass()
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
