import path from 'path';
import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';
import {findActualExecutable} from 'spawn-rx';

const d = require('debug')('surf:build-discover-npm');

export default class DangerBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
    super(rootDir);

    // Danger runs concurrently with other builds
    this.shouldAlwaysRun = true;
  }

  async getAffinityForRootDir() {
    let dangerFile = path.join(this.rootDir, 'Dangerfile');
    let exists = await statNoException(dangerFile);

    if (process.env.SURF_DISABLE_DANGER) return 0;
    if (!exists) return;

    // If we can't find Bundler in PATH, bail
    if (findActualExecutable('bundle').cmd === 'bundle') {
      console.log(`A Dangerfile exists but can't find Ruby and Bundler in PATH, skipping`);
      return 0;
    }

    d(`Found Dangerfile at ${dangerFile}`);
    return exists ? 100 : 0;
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
