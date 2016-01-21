import './support';

import path from 'path';
import { cloneRepo, fetchRepo, cloneOrFetchRepo } from '../src/git-api';
import { rimraf, mkdirp, fs } from '../src/promisify';

const d = require('debug')('serf-test:git-api');

let count = 0;

describe('The node-git helper methods', function() {
  this.timeout(20*1000);

  beforeEach(async function() {
    this.targetDir = await mkdirp(path.join(__dirname, `__nodegit_${++count}`));
    d(`targetDir: ${this.targetDir}`);
  });

  afterEach(async function() {
    //d(this.targetDir);
    await rimraf(this.targetDir);
  });

  it('should clone a public repo with cloneRepo', async function() {
    await cloneRepo('https://github.com/serf-build/serf', this.targetDir);

    let result = await fs.stat(path.join(this.targetDir, 'HEAD'));
    expect(result).to.be.ok;
  });

  it('should fetch a public repo with fetchRepo', async function() {
    await cloneRepo('https://github.com/serf-build/serf', this.targetDir);
    await fetchRepo(this.targetDir);

    let result = await fs.stat(path.join(this.targetDir, 'HEAD'));
    expect(result).to.be.ok;
  });

  it('should clone or fetch a public repo', async function() {
    d('Running clone');
    await cloneOrFetchRepo('https://github.com/serf-build/serf', this.targetDir);

    d('Running fetch');
    let repoDir = await cloneOrFetchRepo('https://github.com/serf-build/serf', this.targetDir);

    let result = await fs.stat(path.join(repoDir, 'HEAD'));
    expect(result).to.be.ok;
  });
});
