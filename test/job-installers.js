import './support';
import SystemdInstaller from '../src/job-installers/systemd';

const d = require('debug')('surf-test:job-installers');

describe('systemd job installer', function() {
  beforeEach(function() {
    this.fixture = new SystemdInstaller();
    this.sampleName = 'example-csharp';
    this.sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"';
  });

  if (process.platform !== 'linux') return;

  it('should capture Surf environment variables', async function() {
    expect((await this.fixture.getAffinityForJob(this.sampleName, this.sampleCommand)) > 0).to.be.ok;

    process.env.SURF_TEST_ENV_VAR = 'hello';
    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);
    delete process.env.SURF_TEST_ENV_VAR;

    d(result);

    expect(
      result.split('\n')
        .find((l) => l.match(/Environment.*SURF_TEST_ENV_VAR.*hello/))
    ).to.be.ok;
  });

  it('should have the command as ExecPath', async function() {
    expect((await this.fixture.getAffinityForJob(this.sampleName, this.sampleCommand)) > 0).to.be.ok;

    let result = await this.fixture.installJob(this.sampleName, this.sampleCommand, true);

    let execStartLine = result.split('\n').find((l) => l.match(/ExecStart/));
    expect(execStartLine.indexOf(this.sampleCommand) > 0).to.be.ok;
  });
});
