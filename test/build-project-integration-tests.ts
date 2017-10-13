import './support';
import {expect} from 'chai';

import * as path from 'path';
import main from '../src/build-project-main';
import {mkdirp, rimraf} from '../src/recursive-fs';

describe('The build project CLI', function() {
  this.timeout(15*1000);

  let testCount = 0;
  beforeEach(async function() {
    this.home = process.env.HOME;
    this.temp = process.env.TMPDIR || process.env.TEMP;

    testCount++;

    this.newHome = path.join(__dirname, `__build_home_${testCount}`);
    await mkdirp(this.newHome);
    process.env.HOME = this.newHome;

    this.newTemp = path.join(__dirname, `__build_temp_${testCount}`);
    await mkdirp(this.newTemp);
    process.env.TMPDIR = process.env.TEMP = this.newTemp;
  });

  afterEach(async function() {
    await rimraf(this.newHome);
    await rimraf(this.newTemp);

    process.env.HOME = this.home;
    process.env.TEMP = process.env.TMPDIR = this.temp;
  });

  it('should compile the example C# app', async function() {
    let args = {
      sha: 'c4d85178b4c46f1e1b56dd3408bb945f6042a40b',
      repo: 'https://github.com/surf-build/example-csharp',
      name: '__test__'
    };

    await main(args, () => { throw new Error("Don't show help"); });
  });
});
