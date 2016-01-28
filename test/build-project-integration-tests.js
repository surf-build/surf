import path from 'path';
import {main} from '../src/build-project-cli';
import {mkdirp, rimraf} from '../src/promisify';

describe('The build project CLI', function() {
  this.timeout(60*1000);

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

  // NB: This is a valid test but takes forever
  it.skip('should compile surf itself', async function() {
    await main('f6db5b824c6d23a5b620d22bb9df7fcc3ee9f2ac', 'https://github.com/surf-build/surf', '__test__');
  });

  it('should compile the example C# app', async function() {
    await main('c4d85178b4c46f1e1b56dd3408bb945f6042a40b', 'https://github.com/surf-build/example-csharp', '__test__');
  });
});
