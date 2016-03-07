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
    let result = _.find(names, (x) => x.match(/CMakeLists\.txt/i));
    return result ? 5 : 0;
  }

  async getBuildCommand() {
    let prefix = path.resolve(this.rootDir, 'surf-artifacts');
    let cmds = [
      { cmd: 'cmake', args: [`-DCMAKE_INSTALL_PREFIX:PATH=${prefix}`, '.']},
      { cmd: 'make', args: ['all', 'install']}
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
