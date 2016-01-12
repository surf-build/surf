import path from 'path';
import {fs} from './promisify';
import BuildDiscoverBase from './build-discover-base';

const d = require('debug')('serf:build-discover-drivers');

const possibleScriptPathsWin32 = [
  'script/ci.ps1',
  'build.cmd'
];

const possibleScriptPathsPosix = [
  'script/ci',
  'build.sh'
];

export class BuildScriptDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
    super(rootDir);
  }

  async getScriptPath() {
    const guesses = process.platform === 'win32' ? possibleScriptPathsWin32 : possibleScriptPathsPosix;

    for (let guess of guesses) {
      try {
        let fullPath = path.join(this.rootDir, guess);
        d(`Looking for file ${fullPath}`);
        let stat = await fs.stat(fullPath);

        d("Found it!");
        if (stat) return fullPath;
      } catch (e) {
        continue;
      }
    }

    d("Didn't find a build script");
    return null;
  }

  async getAffinityForRootDir() {
    let scriptDir = await this.getScriptPath();
    return (scriptDir ? 5 : 0);
  }

  async getBuildCommand() {
    return { cmd: await this.getScriptPath(), args: [] };
  }
}
