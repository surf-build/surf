import _ from 'lodash';
import {fs} from '../promisify';
import BuildDiscoverBase from '../build-discover-base';

export default class XcodeBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let names = await fs.readdir(this.rootDir);
    return _.find(names, (x) => x.match(/(xcworkspace|xcodeproj)$/i)) ? 5 : 0;
  }

  async getBuildCommand() {
    return { cmd: 'xcodebuild', args: []};
  }
}
