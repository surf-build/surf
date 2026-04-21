import createDebug from 'debug'
import { concat } from 'rxjs'
import { share } from 'rxjs/operators'
import { spawn } from 'spawn-rx'
import type { BuildCommand } from './build-discover-base'
import { addFilesToGist, getGistTempdir, pushGistRepoToMaster } from './git-api'

export { createBuildDiscovers } from './build-discover-registry'
export { determineBuildCommands } from './determine-build-commands'

const d = createDebug('surf:build-api')

export function runAllBuildCommands(cmds: BuildCommand[], rootDir: string, sha: string, tempDir: string) {
  const toConcat = cmds.map(({ cmd, args, cwd }) => {
    return runBuildCommand(cmd, args, cwd || rootDir, sha, tempDir)
  })

  return concat(...toConcat).pipe(share())
}

export function runBuildCommand(cmd: string, args: string[], rootDir: string, sha: string, tempDir: string) {
  const envToAdd = {
    SURF_SHA1: sha,
    SURF_ORIGINAL_TMPDIR: process.env.TMPDIR || process.env.TEMP || '/tmp',
    TMPDIR: tempDir,
    TEMP: tempDir,
    TMP: tempDir,
  }

  const opts = {
    cwd: rootDir,
    env: Object.assign({}, process.env, envToAdd),
  }

  d(`Running ${cmd} ${args.join(' ')}...`)
  return spawn(cmd, args, { ...opts, split: false })
}

export async function uploadBuildArtifacts(
  gistId: string,
  gistCloneUrl: string,
  artifactDirs: string[],
  buildLog: string,
  token: string
) {
  const targetDir = getGistTempdir(gistId)

  // Add the build log even though it isn't an artifact
  await addFilesToGist(gistCloneUrl, targetDir, buildLog, token)

  for (const artifactDir of artifactDirs) {
    await addFilesToGist(gistCloneUrl, targetDir, artifactDir, token)
  }

  await pushGistRepoToMaster(targetDir, token)
  return targetDir
}
