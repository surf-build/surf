import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import BuildDiscoverBase, { type BuildCommand } from '../build-discover-base'
import { mkdirp } from '../recursive-fs'

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-drivers')

const possibleScriptPathsWin32 = [
  'script/ci.ps1',
  'script/ci.cmd',
  'script/cibuild.ps1',
  'script/cibuild.cmd',
  'build.ps1',
  'build.cmd',
]

const possibleScriptPathsPosix = ['script/ci', 'script/cibuild', 'build.sh']

export default class BuildScriptDiscoverer extends BuildDiscoverBase {
  async getAffinityForRootDir() {
    const scriptDir = await this.getScriptPath()
    return scriptDir ? 20 : 0
  }

  async getScriptPath() {
    const guesses = process.platform === 'win32' ? possibleScriptPathsWin32 : possibleScriptPathsPosix

    for (const guess of guesses) {
      try {
        const fullPath = path.join(this.rootDir, guess)

        d(`Looking for file ${fullPath}`)
        const statInfo = await stat(fullPath)

        d('Found it!')
        if (statInfo) return fullPath
      } catch (_e) {}
    }

    d("Didn't find a build script")
    return null
  }

  async getBuildCommand() {
    const artifactDir = path.join(this.rootDir, 'surf-artifacts')
    await mkdirp(artifactDir)

    process.env.SURF_ARTIFACT_DIR = artifactDir
    const cmd: BuildCommand = { cmd: (await this.getScriptPath()) || '', args: [], cwd: this.rootDir }

    return {
      cmds: [cmd],
      artifactDirs: [artifactDir],
    }
  }
}
