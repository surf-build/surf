import * as fs from 'fs';
import * as path from 'path';
import * as temp from 'temp';

import JobInstallerBase from '../job-installer-base';
import {findActualExecutable, spawnPromise, spawnDetachedPromise} from 'spawn-rx';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:docker');

// tslint:disable-next-line:no-var-requires
const template = require('lodash.template');

// tslint:disable-next-line:no-var-requires
const pkgJson = require(path.join(__dirname, '..', '..', 'package.json'));

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeDockerfile =
  template(fs.readFileSync(require.resolve('../../src/job-installers/docker.in'), 'utf8'));

export default class DockerInstaller extends JobInstallerBase {
  getName() {
    return 'docker';
  }

  async getAffinityForJob(_name: string, _command: string) {
    let docker = findActualExecutable('docker', []).cmd;
    if (docker === 'docker') {
      d(`Can't find docker in PATH, assuming not installed`);
      return 0;
    }

    // Let local daemons trump docker
    return 3;
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    let opts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      pkgJson, name, command
    };

    if (returnContent) {
      return { 'Dockerfile' : makeDockerfile(opts) };
    }

    let dir = temp.mkdirSync('surf');
    let target = path.join(dir, 'Dockerfile');
    fs.writeFileSync(target, makeDockerfile(opts), 'utf8');

    console.error(`Building Docker image, this will take a bit...`);
    await spawnPromise('docker', ['build', '-t', name, dir]);

    spawnDetachedPromise('docker', ['run', name])
      .catch((e) => console.error(`Failed to execute docker-run! ${e.message}`));

    return { 'README.txt': `Created new docker image: ${name}

To start it: docker run ${name}'` };
  }
}
