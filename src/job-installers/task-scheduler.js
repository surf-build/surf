import _ from 'lodash';
import fs from 'fs';
import os from 'os';
import mkdirp from 'mkdirp';
import path from 'path';
import temp from 'temp';

import JobInstallerBase from '../job-installer-base';
import {findActualExecutable, spawnPromise} from 'spawn-rx';
import runas from 'runas';

const d = require('debug')('surf:task-scheduler');

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeTaskSchedulerXml = 
  _.template(fs.readFileSync(require.resolve('../../src/job-installers/task-scheduler.xml.in'), 'utf8'));
const makeTaskSchedulerCmd = 
  _.template(fs.readFileSync(require.resolve('../../src/job-installers/task-scheduler.cmd.in'), 'utf8'));

export default class TaskSchedulerInstaller extends JobInstallerBase {
  getName() {
    return 'docker';
  }
  
  async getAffinityForJob(name, command) {
    return process.platform === 'win32' ? 5 : 0;
  }

  async installJob(name, command, returnContent=false) {
    // NB: Because Task Scheduler sucks, we need to find a bunch of obscure
    // information first.
    let sidInfo = JSON.parse(await spawnPromise(
      'powershell', 
      ['-Command', 'Add-Type -AssemblyName System.DirectoryServices.AccountManagement; [System.DirectoryServices.AccountManagement.UserPrincipal]::Current | ConvertTo-Json']));
    
    let username, hostname;
    if (sidInfo.UserPrincipalName) {
      let [u,h] = sidInfo.UserPrincipalName.split("@");
      username = u; hostname = h;
    } else {
      username = sidInfo.SamAccountName;
      hostname = os.hostname().toUpperCase();
    }
    
    let shimCmdPath = path.join(process.env.LOCALAPPDATA, 'Surf', `${name}.cmd`);
    
    let xmlOpts = {
      currentDate: (new Date()).toISOString(),
      userSid: sidInfo.Sid.Value,
      workingDirectory: path.resolve('./'),
      shimCmdPath, username, hostname, name 
    };
    
    let cmdOpts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      command
    };
    
    if (returnContent) {
      let ret = {};
      ret[`${name}.xml`] = makeTaskSchedulerXml(xmlOpts);
      ret[`${name}.cmd`] = makeTaskSchedulerCmd(cmdOpts);
    
      return ret;
    } else {
      mkdirp.sync(path.dirname(shimCmdPath));
    }
    
  }
}
