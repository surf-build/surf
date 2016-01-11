import path from 'path';
import {fs} from './promisify';

export class BuildDiscoverBase {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async getAffinityForRootDir() {
    throw new Error("Implement me!");
  }

  async getBuildCommand() {
    throw new Error("Implement me!");
  }
}

const possibleScriptPathsWin32 = [
  'script/ci.ps1',
  'build.cmd'
];

const possibleScriptPathsPosix = [
  'script/ci',
  'build.sh'
];

export class BuildScriptDiscoverer {
  constructor(rootDir) {
    super(rootDir);
  }

  async getScriptPath() {
    const guesses = process.platform === 'win32' ? possibleScriptPathsWin32 : possibleScriptPathsPosix;

    for (let guess of guesses) {
      try {
        let fullPath = path.join(this.rootDir, guess);
        return await fs.stat(fullPath);
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  async getAffinityForRootDir() {
    let scriptDir = await this.getScriptPath();
    return (scriptDir ? 5 : 0);
  }

  getBuildCommand() {
    return this.getScriptPath();
  }
}
