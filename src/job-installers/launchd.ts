import * as fs from 'node:fs'
import * as path from 'node:path'
import stringArgv from 'string-argv'
import xmlescape from 'xml-escape'
import JobInstallerBase from '../job-installer-base'
import { mkdirpSync } from '../recursive-fs'
import { findActualExecutable } from '../spawn-rx'
import { compileTemplate } from '../template'

const makeLaunchdService = compileTemplate(fs.readFileSync(path.join(__dirname, 'launchd.plist.in'), 'utf8'))

export default class LaunchdInstaller extends JobInstallerBase {
  getName() {
    return 'launchd'
  }

  async getAffinityForJob(_name: string, _command: string) {
    return process.platform === 'darwin' ? 5 : 0
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    // NB: launchd requires commands to be have absolute paths
    const m = command.match(/^(\S+)(.*)/)!
    if (!m) throw new Error('Not a command')

    const [, cmd, params] = m
    command = findActualExecutable(cmd, []).cmd

    let opts: Record<string, any> = {
      commandWithoutArgs: command,
      argList: stringArgv(params).map((x: string) => xmlescape(x)),
      envs: this.getInterestingEnvVars().map((x) => [xmlescape(String(x)), xmlescape(String(process.env[x] || ''))]),
      name,
    }

    opts = Object.keys(opts).reduce((acc: Record<string, any>, x) => {
      if (x === 'envs' || x === 'argList') {
        acc[x] = opts[x]
        return acc
      }

      acc[x] = xmlescape(opts[x])
      return acc
    }, {})

    if (returnContent) {
      const ret = {}
      ret[`local.${name}.plist`] = makeLaunchdService(opts)
      return ret
    }

    const target = `${process.env.HOME}/Library/LaunchAgents/local.${name}.plist`

    mkdirpSync(path.dirname(target))
    fs.writeFileSync(target, makeLaunchdService(opts))
    fs.chmodSync(target, 0o644)

    return {
      'README.txt': `launchd agent written to '${target}

launchd agents only run when the current user logs on, because many macOS services
only work interactively, such as the keychain.

To start manually, run launchctl load ${target}`,
    }
  }
}
