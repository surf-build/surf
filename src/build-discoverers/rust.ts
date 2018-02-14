import * as path from 'path';

import {statNoException} from '../promise-array';
import BuildDiscoverBase from '../build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-discover-rust');

export default class RustBuildDiscoverer extends BuildDiscoverBase {
  constructor(rootDir: string) {
    super(rootDir);
  }

  async getAffinityForRootDir() {
    let cargo = path.join(this.rootDir, 'Cargo.toml');
    let exists = await statNoException(cargo);

    if (exists) { d(`Found Cargo.toml at ${cargo}`); }
    return exists ? 5 : 0;
  }

  async getBuildCommand() {
    process.env.RUST_BACKTRACE = '1';
    let cmd = { cmd: 'cargo', args: ['test', '-v'], cwd: this.rootDir };

    return { cmds: [cmd] };
  }
}
