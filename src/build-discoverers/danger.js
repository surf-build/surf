import path from 'path';
import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

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
    
    if (exists) { d(`Found Dangerfile at ${dangerFile}`); }
    return exists ? 2 : 0;
  }

  async getBuildCommand() {
    let cmds = [
      { cmd: 'bundle', args: ['exec', 'danger']}
    ];
  
    return {cmds};
  }
}
