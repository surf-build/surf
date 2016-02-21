import path from 'path';
import {fs, mkdirp} from './promisify';
import BuildDiscoverBase from '../build-discover-base';

const d = require('debug')('surf:build-discover-drivers');

const possibleScriptPathsWin32 = [
  'script/ci.ps1',
  'script/ci.cmd',
  'build.ps1',
  'build.cmd'
];

const possibleScriptPathsPosix = [
  'script/ci',
  'build.sh'
];

export default class BuildScriptDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
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

        d("Found it!");
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
    return { cmd: await this.getScriptPath(), args: [], artifactDirs: [artifactDir] };
  }
}
