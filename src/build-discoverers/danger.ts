import * as path from 'path';
import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';
import {findActualExecutable} from 'spawn-rx';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-npm');

export default class DangerBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);

    // Danger runs concurrently with other builds
    this.shouldAlwaysRun = true;
  }

  async getAffinityForRootDir() {
    const bailedAffinity = 0;
    const dangerFile = path.join(this.rootDir, 'Dangerfile');
    const exists = await statNoException(dangerFile);

    if (process.env.SURF_DISABLE_DANGER || !exists) return bailedAffinity;

    // If we can't find Bundler in PATH, bail
    if (findActualExecutable('bundle', []).cmd === 'bundle') {
      console.log(`A Dangerfile exists but can't find Ruby and Bundler in PATH, skipping`);
      return bailedAffinity;
    }

    d(`Found Dangerfile at ${dangerFile}`);
    return exists ? 100 : bailedAffinity;
  }

  async getBuildCommand() {
    let cmds = [
      { cmd: 'bundle', args: ['install']},
      { cmd: 'bundle', args: ['exec', 'danger']}
    ];

    if (!process.env.SURF_BUILD_NAME) {
      cmds[1].args.push('local');
    }

    if (!process.env.DANGER_GITHUB_API_TOKEN) {
      process.env.DANGER_GITHUB_API_TOKEN = process.env.GITHUB_TOKEN;
    }

    return {cmds};
  }
}
