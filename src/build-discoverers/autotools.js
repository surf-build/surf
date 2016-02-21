import _ from 'lodash';
import path from 'path';

import {fs} from '../promisify';
import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

const d = require('debug')('surf:build-discover-autotools');

export default class AutotoolsBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let names = await fs.readdir(this.rootDir);
    let result = _.find(names, (x) => x.match(/configure\.(in|ac)/i));
    return result ? 5 : 0;
  }

  async getBuildCommand() {
    let cmds = [
      { cmd: path.join(this.rootDir, 'configure'), args: ['--prefix', path.resolve(this.rootDir, 'surf-artifacts')] },
      { cmd: 'make', args: []},
      { cmd: 'make', args: ['install']}
    ];
    
    let autogen = path.join(this.rootDir, 'autogen.sh');
    if (await statNoException(autogen)) {
      cmds.unshift({ cmd: autogen, args: [] });
    }
    
    d(JSON.stringify(cmds));
    return {
      cmds: cmds,
      artifactDirs: [path.join(this.rootDir, 'surf-artifacts')]
    };
  }
}
