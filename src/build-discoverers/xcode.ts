import * as fs from 'mz/fs';
import BuildDiscoverBase from '../build-discover-base';

export default class XcodeBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let names = await fs.readdir(this.rootDir);
    return names.find((x) => !!x.match(/(xcworkspace|xcodeproj)$/i)) ? 5 : 0;
  }

  async getBuildCommand() {
    let cmd = { cmd: 'xcodebuild', args: [], cwd: this.rootDir };
    return { cmds: [cmd] };
  }
}
