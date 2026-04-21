import createDebug from 'debug'
import { findActualExecutable } from 'spawn-rx'
import type BuildDiscoverBase from './build-discover-base'
import type { BuildCommandResult } from './build-discover-base'
import { createBuildDiscovers } from './build-discover-registry'
import { asyncReduce } from './promise-array'

const d = createDebug('surf:build-api')

export async function determineBuildCommands(rootPath: string, sha: string) {
  const discoverers = createBuildDiscovers(rootPath)
  let activeDiscoverers: { affinity: number; discoverer: BuildDiscoverBase }[] = []

  const mainDiscoverer = await asyncReduce(
    discoverers,
    async (acc: { affinity: number; discoverer: BuildDiscoverBase | null }, x) => {
      const affinity = (await x.getAffinityForRootDir()) || 0
      if (affinity < 1) return acc

      if (x.shouldAlwaysRun) {
        activeDiscoverers.push({ affinity, discoverer: x })
        return acc
      }

      return acc.affinity < affinity ? { affinity, discoverer: x } : acc
    },
    { affinity: -1, discoverer: null }
  )

  if (mainDiscoverer.discoverer) {
    activeDiscoverers.push({
      affinity: mainDiscoverer.affinity,
      discoverer: mainDiscoverer.discoverer!,
    })
  }

  activeDiscoverers = activeDiscoverers.sort((a, b) => a.affinity - b.affinity)

  if (activeDiscoverers.length < 1) {
    throw new Error("We can't figure out how to build this repo automatically.")
  }

  const ret: BuildCommandResult = {
    cmds: [],
    artifactDirs: [],
  }

  for (const { discoverer } of activeDiscoverers) {
    const thisCmd = await discoverer.getBuildCommand(sha)

    d(`Discoverer returned ${JSON.stringify(thisCmd)}`)
    const newCmds = thisCmd.cmds.map((x) => {
      return {
        ...findActualExecutable(x.cmd, x.args),
        cwd: x.cwd,
      }
    })
    ret.cmds.push(...newCmds)

    if (thisCmd.artifactDirs) {
      ret.artifactDirs!.push(...thisCmd.artifactDirs)
    }
  }

  ret.cmds.forEach((x) => {
    d(`Actual executable to run: ${x.cmd} ${x.args.join(' ')}`)
  })
  return ret
}
