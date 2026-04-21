import { afterEach, beforeEach, describe, it } from 'bun:test'
import * as path from 'node:path'
import main from '../src/build-project-main'
import { mkdirp, rimraf } from '../src/recursive-fs'

describe('The build project CLI', () => {
  let testCount = 0
  let home = ''
  let temp = ''
  let newHome = ''
  let newTemp = ''

  beforeEach(async () => {
    home = process.env.HOME || ''
    temp = process.env.TMPDIR || process.env.TEMP || ''
    testCount++

    newHome = path.join(__dirname, `__build_home_${testCount}`)
    await mkdirp(newHome)
    process.env.HOME = newHome

    newTemp = path.join(__dirname, `__build_temp_${testCount}`)
    await mkdirp(newTemp)
    process.env.TMPDIR = process.env.TEMP = newTemp
  })

  afterEach(async () => {
    await rimraf(newHome)
    await rimraf(newTemp)

    process.env.HOME = home
    process.env.TEMP = process.env.TMPDIR = temp
  })

  it('should compile the example C# app', async () => {
    const args = {
      sha: 'c4d85178b4c46f1e1b56dd3408bb945f6042a40b',
      repo: 'https://github.com/surf-build/example-csharp',
      name: '__test__',
    }

    await main(args, () => {
      throw new Error("Don't show help")
    })
  }, 15_000)
})
