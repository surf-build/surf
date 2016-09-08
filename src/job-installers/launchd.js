import fs from 'fs';
import path from 'path';
import _ from 'lodash';

import JobInstallerBase from '../job-installer-base';
import {findActualExecutable} from 'spawn-rx';
import stringArgv from 'string-argv';
import xmlescape from 'xml-escape';
import mkdirp from 'mkdirp';

const d = require('debug')('surf:launchd');

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeLaunchdService = 
  _.template(fs.readFileSync(require.resolve('../../src/job-installers/launchd.plist.in'), 'utf8'));

export default class LaunchdInstaller extends JobInstallerBase {
  getName() {
    return 'launchd';
  }
  
  async getAffinityForJob(name, command) {
    return process.platform === 'darwin' ? 5 : 0;
  }

  async installJob(name, command, returnContent=false) {
    // NB: launchd requires commands to be have absolute paths
    let [, cmd, params] = command.match(/^(\S+)(.*)/);
    command = findActualExecutable(cmd, []).cmd;
    
    let opts = {
      commandWithoutArgs: command,
      argList: stringArgv(params).map((x) => xmlescape(x)),
      envs: this.getInterestingEnvVars().map((x) => [xmlescape(x), xmlescape(process.env[x])]),
      name
    };
        
    opts = Object.keys(opts).reduce((acc, x) => {
      if (x === 'envs' || x === 'argList') {
        acc[x] = opts[x];
        return acc;
      }
      
      acc[x] = xmlescape(opts[x]);
      return acc;
    }, {});
    
    if (returnContent) {
      let ret = {};
      ret[`local.${name}.plist`] = makeLaunchdService(opts);
      return ret;
    } 
    
    let target = `${process.env.HOME}/Library/LaunchAgents/local.${name}.plist`;
    
    mkdirp.sync(path.dirname(target));
    fs.writeFileSync(target, makeLaunchdService(opts));
    fs.chmodSync(target, 0o644);
    
    return `launchd agent written to '${target}
  
launchd agents only run when the current user logs on, because many macOS services
only work interactively, such as the keychain.

To start manually, run launchctl load ${target}`;
  }
}
