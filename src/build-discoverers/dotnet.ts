import * as path from 'path';
import * as fs from 'mz/fs';

import {statNoException, readdirRecursive, uniq} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-dotnet');

export default class DotNetBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async findSolutionFile(dir = this.rootDir, recurse = true): Promise<string | null> {
    // Look in one-level's worth of directories for any file ending in sln
    let dentries = await fs.readdir(dir);

    d(dentries.join());
    for (let entry of dentries) {
      let target = path.join(dir, entry);
      let stat = await statNoException(target);

      if (!stat) {
        d(`Failed to stat: ${target}`);
        continue;
      }

      if (stat.isDirectory()) {
        if (!recurse) continue;

        let didItWork = await this.findSolutionFile(target, false);
        if (didItWork) return didItWork;
      }

      if (!target.match(/\.sln$/i)) continue;
      return target;
    }

    return null;
  }

  async getAffinityForRootDir() {
    let file = await this.findSolutionFile();
    return (file ? 10 : 0);
  }

  async getBuildCommand() {
    // TODO: This sucks right now, make it more better'er
    let buildCommand = process.platform === 'win32' ? 'msbuild' : 'xbuild';
    let slnFile: string = (await this.findSolutionFile())!;

    let projFiles = (await readdirRecursive(this.rootDir))
      .filter((x) => x.match(/\.(cs|vb|fs)proj/i));

    let artifactDirs = projFiles.map((x) => path.join(path.dirname(x), 'bin', 'Release'));

    let cmd = { cmd: buildCommand, args: ['/p:Configuration=Release', slnFile], cwd: this.rootDir };

    return {
      cmds: [cmd],
      artifactDirs: uniq(artifactDirs)
    };
  }
}
