import * as path from 'node:path'
import createDebug from 'debug'
import BuildDiscoverBase from '../build-discover-base'
import { statNoException } from '../promise-array'

const d = createDebug('surf:build-discover-rust')

export default class RustBuildDiscoverer extends BuildDiscoverBase {
  async getAffinityForRootDir() {
    const cargo = path.join(this.rootDir, 'Cargo.toml')
    const exists = await statNoException(cargo)

    if (exists) {
      d(`Found Cargo.toml at ${cargo}`)
    }
    return exists ? 5 : 0
  }

  async getBuildCommand() {
    process.env.RUST_BACKTRACE = '1'
    const cmd = { cmd: 'cargo', args: ['test', '-v'], cwd: this.rootDir }

    return { cmds: [cmd] }
  }
}
