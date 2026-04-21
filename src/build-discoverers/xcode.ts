import { readdir } from 'node:fs/promises'
import BuildDiscoverBase from '../build-discover-base'

export default class XcodeBuildDiscoverer extends BuildDiscoverBase {
  async getAffinityForRootDir() {
    const names = await readdir(this.rootDir)
    return names.find((x) => !!x.match(/(xcworkspace|xcodeproj)$/i)) ? 5 : 0
  }

  async getBuildCommand() {
    const cmd = { cmd: 'xcodebuild', args: [], cwd: this.rootDir }
    return { cmds: [cmd] }
  }
}
