import * as path from 'path';
import * as fs from 'mz/fs';
import {mkdirp} from '../recursive-fs';

import BuildDiscoverBase, { BuildCommand } from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-drivers');

const possibleScriptPathsWin32 = [
  'script/ci.ps1',
  'script/ci.cmd',
  'script/cibuild.ps1',
  'script/cibuild.cmd',
  'build.ps1',
  'build.cmd'
];

const possibleScriptPathsPosix = [
  'script/ci',
  'script/cibuild',
  'build.sh'
];

export default class BuildScriptDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let scriptDir = await this.getScriptPath();
    return (scriptDir ? 50 : 0);
  }

  async getScriptPath() {
    const guesses = process.platform === 'win32' ? possibleScriptPathsWin32 : possibleScriptPathsPosix;

    for (let guess of guesses) {
      try {
        let fullPath = path.join(this.rootDir, guess);

        d(`Looking for file ${fullPath}`);
        let stat = await fs.stat(fullPath);

        d('Found it!');
        if (stat) return fullPath;
      } catch (e) {
        continue;
      }
    }

    d("Didn't find a build script");
    return null;
  }

  async getBuildCommand() {
    let artifactDir = path.join(this.rootDir, 'surf-artifacts');
    await mkdirp(artifactDir);

    process.env.SURF_ARTIFACT_DIR = artifactDir;
    let cmd: BuildCommand = { cmd: await this.getScriptPath() || '', args: [], cwd: this.rootDir };

    return {
      cmds: [cmd],
      artifactDirs: [artifactDir]
    };
  }
}
