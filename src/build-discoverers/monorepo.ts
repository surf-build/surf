import * as path from 'path';
import * as fs from 'mz/fs';

import {statNoException, readdirRecursive, uniq, asyncReduce} from '../promise-array';
import BuildDiscoverBase, { BuildCommandResult, BuildCommand } from '../build-discover-base';
import { getChangedFiles } from '../git-api';
import { determineBuildCommands } from '../build-api';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-monorepo');

export interface SurfConfiguration {
  projects: string[];
}

export default class MonoRepoBuildDiscoverer extends BuildDiscoverBase {
  private surfConfiguration?: SurfConfiguration;
  private static ignoreSelf = false;

  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    if (MonoRepoBuildDiscoverer.ignoreSelf) return 0;

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

  async getBuildCommand(sha: string): Promise<BuildCommandResult> {
    const files = await getChangedFiles(this.rootDir);
    const projects = this.surfConfiguration!.projects.map(x => x.toLowerCase());

    let projectsToBuild = files.map(f => {
      return projects.reduce((acc: string, p: string) => {
        if (f.indexOf(p) !== 0) return acc;
        if (acc.length < 1) return p;

        return (acc.length >= p.length) ? acc : p;
      }, '');
    });

    projectsToBuild = uniq(projectsToBuild.filter(x => x && x.length > 2).sort());
    console.error(`Projects to Build:\n================\n${projectsToBuild.join()}`);

    MonoRepoBuildDiscoverer.ignoreSelf = true;
    try {
      return await asyncReduce(projectsToBuild, async (acc: BuildCommandResult, x: string) => {
        let thisProject = await determineBuildCommands(path.join(this.rootDir, x), sha);
        acc.cmds.push(...thisProject.cmds);
        if (thisProject.artifactDirs) acc.artifactDirs!.push(...thisProject.artifactDirs);

        return acc;
      }, { cmds: [], artifactDirs: [] });
    } finally {
      MonoRepoBuildDiscoverer.ignoreSelf = false;
    }
  }
}
