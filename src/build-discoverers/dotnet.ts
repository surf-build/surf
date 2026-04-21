import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import createDebug from 'debug'
import BuildDiscoverBase from '../build-discover-base'
import { readdirRecursive, statNoException, uniq } from '../promise-array'

const d = createDebug('surf:build-discover-dotnet')

export default class DotNetBuildDiscoverer extends BuildDiscoverBase {
  async findSolutionFile(dir = this.rootDir, recurse = true): Promise<string | null> {
    // Look in one-level's worth of directories for any file ending in sln
    const dentries = await readdir(dir)

    d(dentries.join())
    for (const entry of dentries) {
      const target = path.join(dir, entry)
      const stat = await statNoException(target)

      if (!stat) {
        d(`Failed to stat: ${target}`)
        continue
      }

      if (stat.isDirectory()) {
        if (!recurse) continue

        const didItWork = await this.findSolutionFile(target, false)
        if (didItWork) return didItWork
      }

      if (!target.match(/\.sln$/i)) continue
      return target
    }

    return null
  }

  async getAffinityForRootDir() {
    const file = await this.findSolutionFile()
    return file ? 10 : 0
  }

  async getBuildCommand() {
    const slnFile: string = (await this.findSolutionFile())!

    const projFiles = (await readdirRecursive(this.rootDir)).filter((x) => x.match(/\.(cs|vb|fs)proj/i))

    const artifactDirs = projFiles.map((x) => path.join(path.dirname(x), 'bin', 'Release'))

    const cmd = {
      cmd: 'dotnet',
      args: ['build', slnFile, '--configuration', 'Release'],
      cwd: this.rootDir,
    }

    return {
      cmds: [cmd],
      artifactDirs: uniq(artifactDirs),
    }
  }
}
