import * as path from 'path';

import * as fs from 'mz/fs';
import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-autotools');

export default class AutotoolsBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let names = await fs.readdir(this.rootDir);
    let result = names.find((x) => !!x.match(/CMakeLists\.txt/i));
    return result ? 5 : 0;
  }

  async getBuildCommand() {
    let prefix = path.resolve(this.rootDir, 'surf-artifacts');
    let cmds = [
      { cmd: 'cmake', args: [`-DCMAKE_INSTALL_PREFIX:PATH=${prefix}`, '.'], cwd: this.rootDir },
      { cmd: 'make', args: ['all', 'install'], cwd: this.rootDir }
    ];

    let autogen = path.join(this.rootDir, 'autogen.sh');
    if (await statNoException(autogen)) {
      cmds.unshift({ cmd: autogen, args: [], cwd: this.rootDir });
    }

    d(JSON.stringify(cmds));
    return {
      cmds: cmds,
      artifactDirs: [path.join(this.rootDir, 'surf-artifacts')]
    };
  }
}
