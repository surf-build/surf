import * as fs from 'fs';
import * as path from 'path';
import * as template from 'lodash.template';

import JobInstallerBase from '../job-installer-base';
import {findActualExecutable} from 'spawn-rx';
import * as stringArgv from 'string-argv';
import * as xmlescape from 'xml-escape';
import * as mkdirp from 'mkdirp';

// NB: This has to be ../src or else we'll try to get it in ./lib and it'll fail
const makeLaunchdService =
  template(fs.readFileSync(require.resolve('../../src/job-installers/launchd.plist.in'), 'utf8'));

export default class LaunchdInstaller extends JobInstallerBase {
  getName() {
    return 'launchd';
  }

  async getAffinityForJob(_name: string, _command: string) {
    return process.platform === 'darwin' ? 5 : 0;
  }

  async installJob(name: string, command: string, returnContent?: boolean) {
    // NB: launchd requires commands to be have absolute paths
    let m = command.match(/^(\S+)(.*)/)!;
    if (!m) throw new Error('Not a command');

    let [, cmd, params] = m;
    command = findActualExecutable(cmd, []).cmd;

    let opts: Object = {
      commandWithoutArgs: command,
      argList: stringArgv(params).map((x: string) => xmlescape(x)),
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
