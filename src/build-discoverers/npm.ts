import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import createDebug from 'debug'
import BuildDiscoverBase from '../build-discover-base'
import { statNoException } from '../promise-array'

const d = createDebug('surf:build-discover-npm')

export default class NpmBuildDiscoverer extends BuildDiscoverBase {
  async getAffinityForRootDir() {
    const pkgJson = path.join(this.rootDir, 'package.json')
    const exists = await statNoException(pkgJson)

    if (exists) {
      d(`Found package.json at ${pkgJson}`)
    }
    return exists ? 5 : 0
  }

  async getBuildCommand() {
    const pkgJson = JSON.parse(await readFile(path.join(this.rootDir, 'package.json'), 'utf8'))

    const cmds = [{ cmd: 'npm', args: ['install'], cwd: this.rootDir }]

    if (pkgJson.scripts?.test) {
      cmds.push({ cmd: 'npm', args: ['test'], cwd: this.rootDir })
    }

    return { cmds }
  }
}
