import * as path from 'path';
import * as fs from 'mz/fs';

import {statNoException, readdirRecursive} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-monorepo');

export interface SurfConfiguration {
  projects: string[];
}

export default class MonoRepoBuildDiscoverer extends BuildDiscoverBase {
  private surfConfiguration?: SurfConfiguration;

  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    const surfPath = path.join(this.rootDir, '.surf.json');
    if (!statNoException(surfPath)) return 0;

    try {
      this.surfConfiguration = JSON.parse(fs.readFileSync(surfPath, 'utf8'));
    } catch (e) {
      return 0;
    }

    if (!this.surfConfiguration ||
      !this.surfConfiguration.projects ||
      this.surfConfiguration.projects.length < 1) return 0;

    return 50;
  }

  async getBuildCommand(sha: string) {
  }
}
