import * as fs from 'fs';
import * as os from 'os';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as temp from 'temp';

// tslint:disable-next-line:no-var-requires
const template = require('lodash.template');

import JobInstallerBase from '../job-installer-base';
import {spawnPromise} from 'spawn-rx';
import xmlescape from 'xml-escape';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:task-scheduler');

let runAsAdministrator = (cmd: string, params: string[]) => {
  return spawnPromise(cmd, params)
    .then(() => 0)
    .catch((e) => {
      console.error(e.message);
      return -1;
    });
};

(function() {
  try {
    // NB: runas seems to have trouble compiling in various places :-/
    const runas = require('runas');

    runAsAdministrator = (cmd, params) => {
      let {exitCode} = runas(cmd, params, {admin: true, catchOutput: true});
      return Promise.resolve(exitCode);
    };
  } catch (e) {
    if (process.platform === 'win32') {
      console.error("Can't load runas, if this fails try re-running as Elevated Admin");
    }
  }
})();

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeTaskSchedulerXml =
  template(fs.readFileSync(require.resolve('../../src/job-installers/task-scheduler.xml.in'), 'utf8'));
const makeTaskSchedulerCmd =
  template(fs.readFileSync(require.resolve('../../src/job-installers/task-scheduler.cmd.in'), 'utf8'));

export default class TaskSchedulerInstaller extends JobInstallerBase {
  getName() {
    return 'task-scheduler';
  }

  async getAffinityForJob(_name: string, _command: string) {
    return process.platform === 'win32' ? 5 : 0;
  }

  getPathToJobber() {
    let spawnRx = path.dirname(require.resolve('spawn-rx/package.json'));
    return path.join(spawnRx, 'vendor', 'jobber', 'jobber.exe');
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    // NB: Because Task Scheduler sucks, we need to find a bunch of obscure
    // information first.
    let sidInfo = JSON.parse(await spawnPromise(
      'powershell',
      // tslint:disable-next-line:max-line-length
      ['-Command', 'Add-Type -AssemblyName System.DirectoryServices.AccountManagement; [System.DirectoryServices.AccountManagement.UserPrincipal]::Current | ConvertTo-Json']));

    let username, hostname;
    if (sidInfo.UserPrincipalName) {
      let [u,h] = sidInfo.UserPrincipalName.split('@');
      username = u; hostname = h;
    } else {
      username = sidInfo.SamAccountName;
      hostname = os.hostname().toUpperCase();
    }

    let shimCmdPath = path.join(process.env.LOCALAPPDATA!, 'Surf', `${name}.cmd`);

    let xmlOpts: Object = {
      currentDate: (new Date()).toISOString(),
      userSid: sidInfo.Sid.Value,
      workingDirectory: path.resolve('./'),
      jobberDotExe: this.getPathToJobber(),
      shimCmdPath, username, hostname, name
    };

    xmlOpts = Object.keys(xmlOpts).reduce((acc, x) => {
      acc[x] = xmlescape(xmlOpts[x]);
      return acc;
    }, {});

    let cmdOpts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      command
    };

    if (returnContent) {
      let ret = {};
      ret[`${name}.xml`] = makeTaskSchedulerXml(xmlOpts);
      ret[`${name}.cmd`] = makeTaskSchedulerCmd(cmdOpts);

      return ret;
    }

    mkdirp.sync(path.dirname(shimCmdPath));

    fs.writeFileSync(shimCmdPath, makeTaskSchedulerCmd(cmdOpts), 'utf8');

    let info = temp.openSync();
    fs.writeSync(info.fd, makeTaskSchedulerXml(xmlOpts), 0, 'ucs2');
    fs.closeSync(info.fd);

    d(`About to run schtasks, XML path is ${info.path}`);
    let exitCode = await runAsAdministrator('schtasks', ['/Create', '/Tn', name, '/Xml', info.path]);

    if (exitCode !== 0) {
      throw new Error(`Failed to run schtasks, exited with ${exitCode}`);
    }

    return `Created new Scheduled Task ${name}, with script ${shimCmdPath}`;
  }
}
