import * as fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import JobInstallerBase from '../job-installer-base'
import { findActualExecutable, spawnDetachedPromise, spawnPromise } from '../spawn-rx'
import { compileTemplate } from '../template'

// tslint:disable-next-line:no-var-requires
const pkgJson = require(path.join(__dirname, '..', '..', 'package.json'))
const d = require('debug')('surf:docker')

const makeDockerfile = compileTemplate(fs.readFileSync(path.join(__dirname, 'docker.in'), 'utf8'))

export default class DockerInstaller extends JobInstallerBase {
  getName() {
    return 'docker'
  }

  async getAffinityForJob(_name: string, _command: string) {
    const docker = findActualExecutable('docker', []).cmd
    if (docker === 'docker') {
      d(`Can't find docker in PATH, assuming not installed`)
      return 0
    }

    // Let local daemons trump docker
    return 3
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    const opts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      pkgJson,
      name,
      command,
    }

    if (returnContent) {
      return { Dockerfile: makeDockerfile(opts) }
    }

    const dir = mkdtempSync(path.join(os.tmpdir(), 'surf-'))
    const target = path.join(dir, 'Dockerfile')
    fs.writeFileSync(target, makeDockerfile(opts), 'utf8')

    console.error(`Building Docker image, this will take a bit...`)
    await spawnPromise('docker', ['build', '-t', name, dir])

    spawnDetachedPromise('docker', ['run', name]).catch((e) =>
      console.error(`Failed to execute docker-run! ${e.message}`)
    )

    return {
      'README.txt': `Created new docker image: ${name}

To start it: docker run ${name}'`,
    }
  }
}
