import './support';
import {expect} from 'chai';

import * as path from 'path';
import { cloneRepo, fetchRepo, cloneOrFetchRepo, parseGitDiffOutput } from '../src/git-api';
import { rimraf, mkdirp } from '../src/recursive-fs';
import * as fs from 'mz/fs';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf-test:git-api');

let count = 0;

describe('The node-git helper methods', function() {
  this.timeout(20 * 1000);

  beforeEach(async function() {
    this.targetDir = await mkdirp(path.join(__dirname, `__nodegit_${++count}`));
    d(`targetDir: ${this.targetDir}`);
  });

  afterEach(async function() {
    //d(this.targetDir);
    await rimraf(this.targetDir);
  });

  it('should clone a public repo with cloneRepo', async function() {
    let r = await cloneRepo('https://github.com/surf-build/surf', this.targetDir);
    r.free();

    let result = await fs.stat(path.join(this.targetDir, 'HEAD'));
    expect(result).to.be.ok;
  });

  it('should fetch a public repo with fetchRepo', async function() {
    await cloneRepo('https://github.com/surf-build/surf', this.targetDir);
    await fetchRepo(this.targetDir);

    let result = await fs.stat(path.join(this.targetDir, 'HEAD'));
    expect(result).to.be.ok;
  });

  it('should clone or fetch a public repo', async function() {
    d('Running clone');
    await cloneOrFetchRepo('https://github.com/surf-build/surf', this.targetDir);

    d('Running fetch');
    let repoDir = await cloneOrFetchRepo('https://github.com/surf-build/surf', this.targetDir);

    let result = await fs.stat(path.join(repoDir, 'HEAD'));
    expect(result).to.be.ok;
  });
});

describe.only('The parseGitDiffOutput function', function() {
  let diffStatFile = path.join(__dirname, '..', 'fixtures', 'diffstat.txt');
  let fixtureData = fs.readFileSync(diffStatFile, 'utf8');

  it('should parse the fixture file', () => {
    let result = parseGitDiffOutput(fixtureData);

    expect(result).to.contain('src/build-discover-base.ts');
    expect(result).to.contain('test/job-installers.ts');
  });
});