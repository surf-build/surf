import * as fs from 'node:fs'
import * as path from 'node:path'
import JobInstallerBase from '../job-installer-base'
import { statNoException } from '../promise-array'
import { findActualExecutable, spawnPromise } from '../spawn-rx'
import { compileTemplate } from '../template'

const d = require('debug')('surf:systemd')

const makeSystemdService = compileTemplate(fs.readFileSync(path.join(__dirname, 'systemd.service.in'), 'utf8'))

export default class SystemdInstaller extends JobInstallerBase {
  getName() {
    return 'systemd'
  }

  async getAffinityForJob(_name: string, _command: string) {
    if (process.platform !== 'linux') return 0
    const systemctl = await statNoException('/usr/bin/systemctl')

    if (!systemctl) {
      d(`Can't find systemctl, assuming systemd not installed`)
      return 0
    }

    return 5
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    // NB: systemd requires commands to be have absolute paths
    const m = command.match(/^(\S+)(.*)/)!
    if (!m) throw new Error('Not a command')

    const [, cmd, params] = m
    command = findActualExecutable(cmd, []).cmd + params

    const opts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      name,
      command,
    }

    const target = `/etc/systemd/system/${name}.service`

    if (returnContent) {
      const ret = {}
      ret[`${name}.service`] = makeSystemdService(opts)
      return ret
    }

    fs.writeFileSync(target, makeSystemdService(opts))
    await spawnPromise('systemctl', ['daemon-reload'])
    await spawnPromise('systemctl', ['start', name])

    return {
      'README.txt': `systemd service written to '${target}

To run it at system startup: sudo systemctl enable ${name}'`,
    }
  }
}
