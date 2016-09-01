import _ from 'lodash';
import fs from 'fs';
import temp from 'temp';

import JobInstallerBase from '../job-installer-base';
import {findActualExecutable, spawnPromise, spawnPromiseDetached} from 'spawn-rx';

const d = require('debug')('surf:docker');

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeDockerfile = 
  _.template(fs.readFileSync(require.resolve('../../src/job-installers/docker.in'), 'utf8'));

export default class DockerInstaller extends JobInstallerBase {
  getName() {
    return 'docker';
  }
  
  async getAffinityForJob(name, command) {
    let docker = findActualExecutable('docker', []).cmd;
    if (docker === 'docker') {
      d(`Can't find docker in PATH, assuming not installed`);
      return 0;
    }
    
    // Let local daemons trump docker
    return 3;
  }

  async installJob(name, command, returnContent=false) {
    let opts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      pkgJson: require('../../package.json'),
      name, command
    };
    
    if (returnContent) {
      return makeDockerfile(opts);
    } else {
      let {path, fd} = temp.open('surf');
      fs.writeSync(fd, makeDockerfile(opts), 0, 'utf8');
      fs.closeSync(fd);
      
      console.error(`Building Docker image, this will take a bit...`);
      await spawnPromise('docker', ['build', '-t', name, '-f', path]);
      
      spawnPromiseDetached('docker', ['run', name])
        .catch((e) => console.error(`Failed to execute docker-run! ${e.message}`));
    }
    
    return `Created new docker image: ${name}
  
To start it: docker run ${name}'`;
  }
}
