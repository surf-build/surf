import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import BuildDiscoverBase from '../build-discover-base'
import { statNoException } from '../promise-array'

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-autotools')

export default class AutotoolsBuildDiscoverer extends BuildDiscoverBase {
  async getAffinityForRootDir() {
    const names = await readdir(this.rootDir)
    const result = names.find((x) => !!x.match(/configure\.(in|ac)/i))

    return result ? 5 : 0
  }

  async getBuildCommand() {
    const cmds = [
      {
        cmd: path.join(this.rootDir, 'configure'),
        args: ['--prefix', path.resolve(this.rootDir, 'surf-artifacts')],
        cwd: this.rootDir,
      },
      { cmd: 'make', args: [], cwd: this.rootDir },
      { cmd: 'make', args: ['install'], cwd: this.rootDir },
    ]

    const autogen = path.join(this.rootDir, 'autogen.sh')
    if (await statNoException(autogen)) {
      cmds.unshift({ cmd: autogen, args: [], cwd: this.rootDir })
    }

    d(JSON.stringify(cmds))
    return {
      cmds: cmds,
      artifactDirs: [path.join(this.rootDir, 'surf-artifacts')],
    }
  }
}
