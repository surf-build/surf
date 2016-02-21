import path from 'path';
import {fs} from '../promisify';
import BuildDiscoverBase from '../build-discover-base';

//const d = require('debug')('surf:build-discover-npm');

export default class NpmBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let exists = await fs.exists(path.join(this.rootDir, 'package.json'));
    return exists ? 5 : 0;
  }

  async getBuildCommand() {
    let pkgJson = JSON.parse(
      fs.readFile(path.join(this.rootDir, 'package.json'), 'utf8'));
      
    let cmds = [
      { cmd: 'npm', args: ['install']}
    ];
    
    if (pkgJson.scripts && pkgJson.scripts.test) {
      cmds.push({ cmd: 'npm', args: ['test']});
    }
    
    return {cmds};
  }
}
