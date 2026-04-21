import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import createDebug from 'debug'
import { cloneOrFetchRepo, cloneRepo, fetchRepo, parseGitDiffOutput } from '../src/git-api'
import { mkdirp, rimraf } from '../src/recursive-fs'

const d = createDebug('surf-test:git-api')

let count = 0

describe('The node-git helper methods', () => {
  let targetDir = ''

  beforeEach(async () => {
    targetDir = await mkdirp(path.join(__dirname, `__nodegit_${++count}`))
    d(`targetDir: ${targetDir}`)
  })

  afterEach(async () => {
    await rimraf(targetDir)
  })

  it('should clone a public repo with cloneRepo', async () => {
    await cloneRepo('https://github.com/surf-build/surf', targetDir)

    const result = await stat(path.join(targetDir, 'HEAD'))
    expect(result).toBeTruthy()
  }, 20_000)

  it('should fetch a public repo with fetchRepo', async () => {
    await cloneRepo('https://github.com/surf-build/surf', targetDir)
    await fetchRepo(targetDir)

    const result = await stat(path.join(targetDir, 'HEAD'))
    expect(result).toBeTruthy()
  }, 20_000)

  it('should clone or fetch a public repo', async () => {
    d('Running clone')
    await cloneOrFetchRepo('https://github.com/surf-build/surf', targetDir)

    d('Running fetch')
    const repoDir = await cloneOrFetchRepo('https://github.com/surf-build/surf', targetDir)

    const result = await stat(path.join(repoDir, 'HEAD'))
    expect(result).toBeTruthy()
  }, 20_000)
})

describe('The parseGitDiffOutput function', () => {
  const diffStatFile = path.join(__dirname, '..', 'fixtures', 'diffstat.txt')
  const fixtureData = readFileSync(diffStatFile, 'utf8')

  it('should parse the fixture file', () => {
    const result = parseGitDiffOutput(fixtureData)

    expect(result).toContain('src/build-discover-base.ts')
    expect(result).toContain('test/job-installers.ts')
  })
})
