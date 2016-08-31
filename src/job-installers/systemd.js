import fs from 'fs';
import _ from 'lodash';

import JobInstallerBase from '../job-installer-base';
import {statNoException} from '../promise-array';
import {spawnPromise} from 'spawn-rx';

const makeSystemdService =
  _.template(fs.readFileSync(require.resolve('./systemd.in'), 'utf8'));

export default class SystemdInstaller extends JobInstallerBase {
  async getAffinityForJob(name, command) {
    if (process.platform !== 'linux') return 0;
    let systemctl = await statNoException('/usr/bin/systemctl');

    return systemctl ? 5 : 0;
  }

  async installJob(name, command, returnContent=false) {
    let opts = {
      envs: this.getInterestingEnvVars().map((x) => `${x}=${process.env[x]}`),
      name, command
    };

    let realName = `surf-${name}`;
    let target = `/etc/systemd/system/${realName}.service`;

    if (returnContent) {
      return makeSystemdService(opts);
    } else {
      fs.writeFileSync(target, makeSystemdService(opts));
      await spawnPromise('systemctl', ['daemon-reload']);
      await spawnPromise('systemctl', ['enable', realName]);
    }

    return `systemd service written to '${target}'`;
  }
}
