import * as path from 'path';
import * as fs from 'mz/fs';

import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-npm');

export default class NpmBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let pkgJson = path.join(this.rootDir, 'package.json');
    let exists = await statNoException(pkgJson);

    if (exists) { d(`Found package.json at ${pkgJson}`); }
    return exists ? 5 : 0;
  }

  async getBuildCommand() {
    let pkgJson = JSON.parse(
      await fs.readFile(path.join(this.rootDir, 'package.json'), 'utf8'));

    let cmds = [
      { cmd: 'npm', args: ['install'], cwd: this.rootDir }
    ];

    if (pkgJson.scripts && pkgJson.scripts.test) {
      cmds.push({ cmd: 'npm', args: ['test'], cwd: this.rootDir });
    }

    return {cmds};
  }
}
