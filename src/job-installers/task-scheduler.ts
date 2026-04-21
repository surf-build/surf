import * as fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import xmlescape from 'xml-escape'
import JobInstallerBase from '../job-installer-base'
import { mkdirpSync } from '../recursive-fs'
import { spawnPromise } from '../spawn-rx'
import { compileTemplate } from '../template'

const d = require('debug')('surf:task-scheduler')

let runAsAdministrator = (cmd: string, params: string[]) => {
  return spawnPromise(cmd, params)
    .then(() => 0)
    .catch((e) => {
      console.error(e.message)
      return -1
    })
}

;(() => {
  try {
    // NB: runas seems to have trouble compiling in various places :-/
    const runas = require('runas')

    runAsAdministrator = (cmd, params) => {
      const { exitCode } = runas(cmd, params, { admin: true, catchOutput: true })
      return Promise.resolve(exitCode)
    }
  } catch (_e) {
    if (process.platform === 'win32') {
      console.error("Can't load runas, if this fails try re-running as Elevated Admin")
    }
  }
})()

const makeTaskSchedulerXml = compileTemplate(fs.readFileSync(path.join(__dirname, 'task-scheduler.xml.in'), 'utf8'))
const makeTaskSchedulerCmd = compileTemplate(fs.readFileSync(path.join(__dirname, 'task-scheduler.cmd.in'), 'utf8'))

export default class TaskSchedulerInstaller extends JobInstallerBase {
  getName() {
    return 'task-scheduler'
  }

  async getAffinityForJob(_name: string, _command: string) {
    return process.platform === 'win32' ? 5 : 0
  }

  getPathToJobber() {
    const spawnRx = path.dirname(require.resolve('spawn-rx/package.json'))
    return path.join(spawnRx, 'vendor', 'jobber', 'jobber.exe')
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    // NB: Because Task Scheduler sucks, we need to find a bunch of obscure
    // information first.
    const sidInfo = JSON.parse(
      await spawnPromise(
        'powershell',
        // tslint:disable-next-line:max-line-length
        [
          '-Command',
          'Add-Type -AssemblyName System.DirectoryServices.AccountManagement; [System.DirectoryServices.AccountManagement.UserPrincipal]::Current | ConvertTo-Json',
        ]
      )
    )

    let username, hostname
    if (sidInfo.UserPrincipalName) {
      const [u, h] = sidInfo.UserPrincipalName.split('@')
      username = u
      hostname = h
    } else {
      username = sidInfo.SamAccountName
      hostname = os.hostname().toUpperCase()
    }

    const shimCmdPath = path.join(process.env.LOCALAPPDATA!, 'Surf', `${name}.cmd`)

    let xmlOpts: Record<string, any> = {
      currentDate: new Date().toISOString(),
      userSid: sidInfo.Sid.Value,
      workingDirectory: path.resolve('./'),
      jobberDotExe: this.getPathToJobber(),
      shimCmdPath,
      username,
      hostname,
      name,
    }

    xmlOpts = Object.keys(xmlOpts).reduce((acc: Record<string, any>, x) => {
      acc[x] = xmlescape(xmlOpts[x])
      return acc
    }, {})

    const cmdOpts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      command,
    }

    if (returnContent) {
      const ret = {}
      ret[`${name}.xml`] = makeTaskSchedulerXml(xmlOpts)
      ret[`${name}.cmd`] = makeTaskSchedulerCmd(cmdOpts)

      return ret
    }

    mkdirpSync(path.dirname(shimCmdPath))

    fs.writeFileSync(shimCmdPath, makeTaskSchedulerCmd(cmdOpts), 'utf8')

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'surf-'))
    const tempPath = path.join(tempDir, `${name}.xml`)
    fs.writeFileSync(tempPath, makeTaskSchedulerXml(xmlOpts), 'ucs2')

    d(`About to run schtasks, XML path is ${tempPath}`)
    const exitCode = await runAsAdministrator('schtasks', ['/Create', '/Tn', name, '/Xml', tempPath])

    if (exitCode !== 0) {
      throw new Error(`Failed to run schtasks, exited with ${exitCode}`)
    }

    return { 'README.txt': `Created new Scheduled Task ${name}, with script ${shimCmdPath}` }
  }
}
