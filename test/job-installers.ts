import { beforeEach, describe, expect, it } from 'bun:test'
import createDebug from 'debug'
import { installJob } from '../src/job-installer-api'
import DockerInstaller from '../src/job-installers/docker'
import LaunchdInstaller from '../src/job-installers/launchd'
import SystemdInstaller from '../src/job-installers/systemd'
import TaskSchedulerInstaller from '../src/job-installers/task-scheduler'

const d = createDebug('surf-test:job-installers')
const sampleName = 'example-csharp'
const sampleCommand = 'surf-build -r https://github.com/surf-build/example-csharp -- surf-build -n "surf"'

describe('systemd job installer', () => {
  let fixture: SystemdInstaller

  beforeEach(() => {
    fixture = new SystemdInstaller()
  })

  it('should capture Surf environment variables', async () => {
    process.env.SURF_TEST_ENV_VAR = 'hello'
    const result = await fixture.installJob(sampleName, sampleCommand, true)
    delete process.env.SURF_TEST_ENV_VAR

    d(result)

    expect(
      result[`${sampleName}.service`].split('\n').find((l: string) => l.match(/Environment.*SURF_TEST_ENV_VAR.*hello/))
    ).toBeTruthy()
  })

  it('should have the command as ExecPath', async () => {
    const result = await fixture.installJob(sampleName, sampleCommand, true)

    const execStartLine = result[`${sampleName}.service`].split('\n').find((l: string) => l.match(/ExecStart/))
    expect(execStartLine.indexOf(sampleCommand)).toBeGreaterThan(0)
  })

  it('should ensure that absolute paths are rooted', async () => {
    if (process.platform === 'win32') return

    const result = await fixture.installJob(sampleName, 'ls -al', true)

    const execStartLine = result[`${sampleName}.service`].split('\n').find((l: string) => l.match(/ExecStart/))

    d(`execStartLine: ${execStartLine}`)
    expect(execStartLine.indexOf('/bin/ls')).toBeGreaterThan(0)
  })
})

describe('docker job installer', () => {
  let fixture: DockerInstaller

  beforeEach(() => {
    fixture = new DockerInstaller()
  })

  it('should capture Surf environment variables', async () => {
    process.env.SURF_TEST_ENV_VAR = 'hello'
    const result = await fixture.installJob(sampleName, sampleCommand, true)
    delete process.env.SURF_TEST_ENV_VAR
    const dockerfile = result.Dockerfile || ''

    d(result)

    expect(dockerfile.split('\n').find((l: string) => l.match(/ENV .*SURF_TEST_ENV_VAR.*hello/))).toBeTruthy()
  })

  it('should have the command as CMD', async () => {
    const result = await fixture.installJob(sampleName, sampleCommand, true)
    const dockerfile = result.Dockerfile || ''

    const execStartLine = dockerfile.split('\n').find((l: string) => l.match(/CMD/))

    d(`execStartLine: ${execStartLine}`)
    expect(execStartLine).toBeTruthy()
    expect(execStartLine!.indexOf(sampleCommand.split(' ')[0])).toBeGreaterThan(0)
  })
})

if (process.platform === 'win32') {
  describe('Task scheduler job installer', () => {
    let fixture: TaskSchedulerInstaller

    beforeEach(() => {
      fixture = new TaskSchedulerInstaller()
    })

    it('should capture Surf environment variables', async () => {
      process.env.SURF_TEST_ENV_VAR = 'hello'
      const result = await fixture.installJob(sampleName, sampleCommand, true)
      delete process.env.SURF_TEST_ENV_VAR

      d(JSON.stringify(result))

      expect(
        result[`${sampleName}.cmd`].split('\n').find((l: string) => l.match(/SET.*SURF_TEST_ENV_VAR.*hello/))
      ).toBeTruthy()
    }, 10_000)

    it('should have the command', async () => {
      expect(await fixture.getAffinityForJob(sampleName, sampleCommand)).toBeGreaterThan(0)

      const result = await fixture.installJob(sampleName, sampleCommand, true)
      const execStartLine = result[`${sampleName}.cmd`].split('\n').find((l: string) => l.match(/surf-build/))

      expect(execStartLine).toBeTruthy()
    }, 10_000)
  })
}

describe('launchd job installer', () => {
  let fixture: LaunchdInstaller

  beforeEach(() => {
    fixture = new LaunchdInstaller()
  })

  it('should capture Surf environment variables', async () => {
    process.env.SURF_TEST_ENV_VAR = 'hello'
    const result = await fixture.installJob(sampleName, sampleCommand, true)
    delete process.env.SURF_TEST_ENV_VAR

    d(result)

    expect(
      result[`local.${sampleName}.plist`]
        .split('\n')
        .find((l: string) => l.match(/key.*SURF_TEST_ENV_VAR.*string.*hello/))
    ).toBeTruthy()
  })

  it('should have the command', async () => {
    const result = await fixture.installJob(sampleName, sampleCommand, true)

    const execStartLine = result[`local.${sampleName}.plist`].split('\n').find((l: string) => l.match(/Program/))
    expect(execStartLine.indexOf(sampleCommand.split(' ')[0])).toBeGreaterThan(0)
  })

  it('should ensure that absolute paths are rooted', async () => {
    if (process.platform === 'win32') return

    const result = await fixture.installJob(sampleName, 'ls -al', true)

    const execStartLine = result[`local.${sampleName}.plist`].split('\n').find((l: string) => l.match(/Program/))

    d(`execStartLine: ${execStartLine}`)
    expect(execStartLine.indexOf('/bin/ls')).toBeGreaterThan(0)
  })
})

describe('Job installer API', () => {
  it('should return some content', async () => {
    const result = await installJob(sampleName, sampleCommand, true)
    const keys = Object.keys(result)
    expect((result[keys[0]] || '').split('\n').length).toBeGreaterThan(2)
  }, 10_000)

  it('should capture extra env vars', async () => {
    process.env.__FOOBAR = 'baz'
    process.env.__BAMF = 'baz'
    const result = await installJob(sampleName, sampleCommand, true, 'docker', ['__FOOBAR', '__BAMF'])
    delete process.env.__BAMF
    delete process.env.__FOOBAR

    const lines = (result.Dockerfile || '').split('\n')
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.find((x: string) => x.match(/^ENV.*FOOBAR.*baz/))).toBeTruthy()
    expect(lines.find((x: string) => x.match(/^ENV.*BAMF.*baz/))).toBeTruthy()
  }, 10_000)

  it('should allow us to explicitly select the Docker API', async () => {
    const result = await installJob(sampleName, sampleCommand, true, 'docker')
    const lines = (result.Dockerfile || '').split('\n')

    expect(lines.length).toBeGreaterThan(2)
    expect(lines.find((x: string) => x.match(/^CMD /))).toBeTruthy()
    expect(lines.find((x: string) => x.match(/^ExecPath/))).toBeFalsy()
  }, 10_000)
})
