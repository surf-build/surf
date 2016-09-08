import './support';

import SystemdInstaller from '../src/job-installers/systemd';
import DockerInstaller from '../src/job-installers/docker';
import TaskSchedulerInstaller from '../src/job-installers/task-scheduler';
import LaunchdInstaller from '../src/job-installers/launchd';
import {installJob} from '../src/job-installer-api';

const d = require('debug')('surf-test:job-installers');

describe('systemd job installer', function() {
  beforeEach(function() {
    this.fixture = new SystemdInstaller();
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });

  it('should capture Surf environment variables', async function() {
    process.env.SURF_TEST_ENV_VAR = 'hello';
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);
    delete process.env.SURF_TEST_ENV_VAR;

    d(result);

    expect(
      result[`${this.sampleName}.service`].split('\n')
        .find((l) => l.match(/Environment.*SURF_TEST_ENV_VAR.*hello/))
    ).to.be.ok;
  });

  it('should have the command as ExecPath', async function() {
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);

    let execStartLine = result[`${this.sampleName}.service`].split('\n')
      .find((l) => l.match(/ExecStart/));
    expect(execStartLine.indexOf(this.sampleCommand) > 0).to.be.ok;
  });

  it('should ensure that absolute paths are rooted', async function() {
    if (process.platform === 'win32') return;
  
    let result = await this.fixture.installJob(this.sampleName, 'ls -al', true);

    let execStartLine = result[`${this.sampleName}.service`].split('\n').find((l) => l.match(/ExecStart/));
    
    d(`execStartLine: ${execStartLine}`);
    expect(execStartLine.indexOf('/usr/bin/ls') > 0).to.be.ok;
  });
});

describe('docker job installer', function() {
  beforeEach(function() {
    this.fixture = new DockerInstaller();
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });
  
  it('should capture Surf environment variables', async function() {
    process.env.SURF_TEST_ENV_VAR = 'hello';
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);
    delete process.env.SURF_TEST_ENV_VAR;

    d(result);

    expect(
      result['Dockerfile'].split('\n')
        .find((l) => l.match(/ENV .*SURF_TEST_ENV_VAR.*hello/))
    ).to.be.ok;
  });

  it('should have the command as CMD', async function() {
    expect((await this.fixture.getAffinityForJob(this.sampleName, this.sampleCommand)) > 0).to.be.ok;

    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);

    let execStartLine = result['Dockerfile'].split('\n').find((l) => l.match(/CMD/));
    d(`execStartLine: ${execStartLine}`);
    expect(execStartLine.indexOf(this.sampleCommand.split(' ')[0]) > 0).to.be.ok;
  });
});

describe('Task scheduler job installer', function() {
  if (process.platform !== 'win32') return;
  
  beforeEach(function() {
    this.fixture = new TaskSchedulerInstaller();
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });
  
  it('should capture Surf environment variables', async function() {
    process.env.SURF_TEST_ENV_VAR = 'hello';
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);
    delete process.env.SURF_TEST_ENV_VAR;

    d(JSON.stringify(result));

    expect(
      result[`${this.sampleName}.cmd`].split('\n')
        .find((l) => l.match(/SET.*SURF_TEST_ENV_VAR.*hello/))
    ).to.be.ok;
  });

  it('should have the command', async function() {
    expect((await this.fixture.getAffinityForJob(this.sampleName, this.sampleCommand)) > 0).to.be.ok;

    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);

    let execStartLine = result[`${this.sampleName}.cmd`].split('\n')
      .find((l) => l.match(/surf-build/));
    expect(execStartLine).to.be.ok;
  });
});

describe('launchd job installer', function() {
  beforeEach(function() {
    this.fixture = new LaunchdInstaller();
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });

  it('should capture Surf environment variables', async function() {
    process.env.SURF_TEST_ENV_VAR = 'hello';
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);
    delete process.env.SURF_TEST_ENV_VAR;

    d(result);

    expect(
      result[`local.${this.sampleName}.plist`].split('\n')
        .find((l) => l.match(/key.*SURF_TEST_ENV_VAR.*string.*hello/))
    ).to.be.ok;
  });

  it('should have the command', async function() {
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);

    let execStartLine = result[`local.${this.sampleName}.plist`].split('\n')
      .find((l) => l.match(/Program/));
    expect(execStartLine.indexOf(this.sampleCommand.split(' ')[0]) > 0).to.be.ok;
  });

  it('should ensure that absolute paths are rooted', async function() {
    if (process.platform === 'win32') return;
  
    let result = await this.fixture.installJob(this.sampleName, 'ls -al', true);

    let execStartLine = result[`local.${this.sampleName}.plist`].split('\n').find((l) => l.match(/Program/));
    
    d(`execStartLine: ${execStartLine}`);
    expect(execStartLine.indexOf('/bin/ls') > 0).to.be.ok;
  });
});

describe('Job installer API', function() {
  beforeEach(function() {
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });

  it('should return some content', async function() {
    let result = await installJob(this.sampleName, this.sampleCommand, true);
    let keys = Object.keys(result);
    expect(result[keys[0]].split('\n').length > 2).to.be.ok;
  });
  
  it('should capture extra env vars', async function() {
    process.env.__FOOBAR = 'baz';
    process.env.__BAMF = 'baz';
    let result = await installJob(this.sampleName, this.sampleCommand, true, 'docker', ['__FOOBAR', '__BAMF']);
    delete process.env.__BAMF;
    delete process.env.__FOOBAR;
    
    let lines = result['Dockerfile'].split('\n');
    expect(lines.length > 2).to.be.ok;
    expect(lines.find((x) => x.match(/^ENV.*FOOBAR.*baz/))).to.be.ok;
    expect(lines.find((x) => x.match(/^ENV.*BAMF.*baz/))).to.be.ok;
  });

  it('should allow us to explicitly select the Docker API', async function() {
    let result = await installJob(this.sampleName, this.sampleCommand, true, 'docker');
    let lines = result['Dockerfile'].split('\n');
    
    expect(lines.length > 2).to.be.ok;
    expect(lines.find((x) => x.match(/^CMD /))).to.be.ok;
    expect(lines.find((x) => x.match(/^ExecPath/))).not.to.be.ok;
  });
});
