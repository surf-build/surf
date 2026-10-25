import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import createDebug from 'debug'
import { cloneOrFetchRepo, cloneRepo, fetchRepo, git, parseGitDiffOutput, resolveRefToSha } from '../src/git-api'
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

describe('The resolveRefToSha function', () => {
  let baseDir = ''
  let sourceDir = ''
  let bareDir = ''
  let mainSha = ''
  let branchSha = ''

  const commit = (dir: string, message: string) =>
    git(['-c', 'user.email=surf@example.com', '-c', 'user.name=Surf', 'commit', '--allow-empty', '-m', message], dir)

  beforeEach(async () => {
    baseDir = await mkdirp(path.join(__dirname, `__resolve_ref_${++count}`))
    sourceDir = path.join(baseDir, 'source')
    bareDir = path.join(baseDir, 'bare')
    await mkdirp(sourceDir)

    await git(['init', '-b', 'main'], sourceDir)
    await commit(sourceDir, 'initial')

    await git(['checkout', '-b', 'some-branch'], sourceDir)
    await commit(sourceDir, 'branch commit')
    branchSha = await git(['rev-parse', 'HEAD'], sourceDir)

    await git(['checkout', 'main'], sourceDir)
    mainSha = await git(['rev-parse', 'HEAD'], sourceDir)
    await git(
      ['-c', 'user.email=surf@example.com', '-c', 'user.name=Surf', 'tag', '-a', 'some-tag', '-m', 'tag'],
      sourceDir
    )

    // Surf talks to a bare clone, so resolve against one here too
    await git(['clone', '--bare', sourceDir, bareDir], baseDir)
  })

  afterEach(async () => {
    await rimraf(baseDir)
  })

  it('should resolve a full SHA1 to itself', async () => {
    expect(await resolveRefToSha(bareDir, mainSha)).toBe(mainSha)
  })

  it('should resolve an abbreviated SHA1', async () => {
    expect(await resolveRefToSha(bareDir, mainSha.slice(0, 8))).toBe(mainSha)
  })

  it('should resolve a branch name to its commit', async () => {
    expect(await resolveRefToSha(bareDir, 'some-branch')).toBe(branchSha)
  })

  it('should resolve a refs/heads-prefixed branch name', async () => {
    expect(await resolveRefToSha(bareDir, 'refs/heads/some-branch')).toBe(branchSha)
  })

  it('should resolve a tag name to its commit', async () => {
    expect(await resolveRefToSha(bareDir, 'some-tag')).toBe(mainSha)
  })

  it('should throw for something that is not a ref', async () => {
    await expect(resolveRefToSha(bareDir, 'not-a-branch')).rejects.toThrow()
  })
})
