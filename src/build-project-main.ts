import { open } from 'node:fs/promises'
import * as path from 'node:path'
import onDeath from 'death'
import { lastValueFrom } from 'rxjs'
import { concatMap, reduce } from 'rxjs/operators'
import { determineBuildCommands, runAllBuildCommands, uploadBuildArtifacts } from './build-api'
import {
  checkoutSha,
  cloneOrFetchRepo,
  cloneRepo,
  getHeadForRepo,
  getOriginForRepo,
  getTempdirForRepoUrl,
  getWorkdirForRepoUrl,
  resetOriginUrl,
} from './git-api'
import { createGist, findPRForCommit, getNwoFromRepoUrl, getSanitizedRepoUrl, postCommitStatus } from './github-api'
import { retryPromise } from './promise-array'
import { mkdirpSync, rimraf } from './recursive-fs'

const DeathPromise = new Promise<number>((_res, rej) => {
  onDeath((sig: number) => rej(new Error(`Signal ${sig} thrown`)))
})

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:surf-build')

function getRootAppDir() {
  let ret: string
  const tmp = process.env.TMPDIR || process.env.TEMP || '/tmp'

  switch (process.platform) {
    case 'win32':
      ret = path.join(process.env.LOCALAPPDATA!, 'surf')
      break
    case 'darwin':
      ret = process.env.HOME
        ? path.join(process.env.HOME!, 'Library', 'Application Support', 'surf')
        : path.join(tmp, 'surf-repos')
      break
    default:
      ret = process.env.HOME ? path.join(process.env.HOME!, '.config', 'surf') : path.join(tmp, 'surf-repos')
      break
  }

  mkdirpSync(ret)
  return ret
}

function getRepoCloneDir() {
  return path.join(getRootAppDir(), 'repos')
}

function truncateErrorMessage(errorMessage: string) {
  return errorMessage.split('\n')[0].substr(0, 256)
}

export default function main(argv: any, showHelp: () => void) {
  return Promise.race([realMain(argv, showHelp), DeathPromise]).then(
    (x) => Promise.resolve(x),
    (e) => {
      d('Build being taken down!')
      if (argv.name) {
        const repo = argv.repo || process.env.SURF_REPO
        const sha = argv.sha || process.env.SURF_SHA1
        const nwo = getNwoFromRepoUrl(repo)

        console.error(`Build Errored: ${e.message}`)

        d(`Attempting to post error status!`)
        return retryPromise(() => {
          return postCommitStatus(
            nwo,
            sha,
            'error',
            `Build Errored: ${truncateErrorMessage(e.message)}`,
            null,
            argv.name
          )
        })
          .catch(() => true)
          .then(() => d(`We did it!`))
          .then(() => Promise.reject(e))
      } else {
        return Promise.reject(e)
      }
    }
  )
}

async function configureEnvironmentVariablesForChild(nwo: string, sha: string, name: string, repo: string) {
  process.env.SURF_NWO = nwo
  process.env.SURF_REPO = repo
  if (name) process.env.SURF_BUILD_NAME = name

  // If the current PR number isn't set, try to recreate it
  try {
    if (!process.env.SURF_PR_NUM) {
      const pr = await findPRForCommit(nwo, sha)

      if (pr) {
        process.env.SURF_PR_NUM = pr.number
        process.env.SURF_REF = pr.head.ref
      }
    }
  } catch (e) {
    d(`Couldn't fetch PR for commit: ${e.message}`)
  }
}

async function realMain(argv: any, showHelp: () => void) {
  let sha = argv.sha || process.env.SURF_SHA1
  let repo = argv.repo || process.env.SURF_REPO
  let name = argv.name

  if (argv.help) {
    showHelp()
    process.exit(0)
  }

  if (name === '__test__') {
    // NB: Don't end up setting statuses in unit tests, even if argv.name is set
    name = null
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'))
      argv.repo = repo
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo')
      d(e.stack)

      showHelp()
      process.exit(-1)
    }
  }

  if (!repo) {
    showHelp()
    process.exit(-1)
  }

  const repoDir = getRepoCloneDir()

  d(`Running initial cloneOrFetchRepo: ${repo} => ${repoDir}`)
  const bareRepoDir = await retryPromise(() => cloneOrFetchRepo(repo, repoDir))

  if (!sha) {
    d(`SHA1 not specified, trying to retrieve SHA1 for current repo in directory`)
    try {
      sha = await getHeadForRepo(process.cwd())
      argv.sha = sha
      d(`Current checkout is at ${sha}`)
    } catch (e) {
      console.error(`Failed to find the commit for cwd ${process.cwd()}: ${e.message}`)
      d(e.stack)
    }
  }

  if (!sha) {
    d(`SHA1 not specified, trying to retrieve default branch`)
    try {
      sha = await getHeadForRepo(bareRepoDir)
      argv.sha = sha
      d(`Default branch is ${sha}`)
    } catch (e) {
      console.error(`Failed to find the current commit for repo ${repo}: ${e.message}`)
      d(e.stack)

      showHelp()
      process.exit(-1)
    }
  }

  const nwo = getNwoFromRepoUrl(repo)
  await configureEnvironmentVariablesForChild(nwo, sha, name, repo)

  d(`repo: ${repo}, sha: ${sha}`)

  if (name) {
    d(`Posting 'pending' to GitHub status`)

    const nwo = getNwoFromRepoUrl(repo)
    await retryPromise(() => postCommitStatus(nwo, sha, 'pending', 'Surf Build Server', null, name))
  }

  const workDir = getWorkdirForRepoUrl(repo, sha)
  const tempDir = getTempdirForRepoUrl(repo, sha)

  d(`Cloning to work directory: ${workDir}`)
  await retryPromise(() => cloneRepo(bareRepoDir, workDir, '', false))

  d(`Checking out to given SHA1: ${sha}`)
  await checkoutSha(workDir, sha)

  d(`Resetting remote origin to URL`)
  await resetOriginUrl(workDir, repo)

  d(`Determining command to build`)
  const { cmds, artifactDirs } = await determineBuildCommands(workDir, sha)

  let buildPassed = true
  const buildLog = path.join(workDir, 'build-output.log')
  const buildLogFile = await open(buildLog, 'w')

  try {
    const buildStream = runAllBuildCommands(cmds, workDir, sha, tempDir)
    await lastValueFrom(
      buildStream.pipe(
        concatMap(async (output: string) => {
          console.log(output.replace(/[\r\n]+$/, ''))
          await buildLogFile.write(output)
          return output
        }),
        reduce(() => null, null)
      )
    )
  } catch (error) {
    buildPassed = false
    console.error(error.message)
    await buildLogFile.write(`${error.message}\n`)
  } finally {
    await buildLogFile.close()
  }

  if (name) {
    d(`Posting to GitHub status`)
    const nwo = getNwoFromRepoUrl(repo)

    const gistInfo = await retryPromise(() =>
      createGist(`Build completed: ${nwo}#${sha}, ${new Date()}`, {
        'README.md': { content: `## Build for ${nwo} ${buildPassed ? 'succeeded' : 'failed'} on ${new Date()}` },
      })
    )

    d(`Gist result: ${gistInfo.result.html_url}`)
    d(`Gist clone URL: ${gistInfo.result.git_pull_url}`)
    const token = process.env.GIST_TOKEN || process.env.GITHUB_TOKEN || ''

    try {
      d(`Uploading build artifacts using token: ${token}`)
      await retryPromise(() =>
        uploadBuildArtifacts(gistInfo.result.id, gistInfo.result.git_pull_url, artifactDirs || [], buildLog, token)
      )
    } catch (e) {
      console.error(`Failed to upload build artifacts: ${e.message}`)
      d(e.stack)
    }

    await postCommitStatus(
      nwo,
      sha,
      buildPassed ? 'success' : 'failure',
      'Surf Build Server',
      gistInfo.result.html_url,
      name
    )
  }

  if (buildPassed && !process.env.DEBUG) {
    await rimraf(tempDir)
  }

  return buildPassed ? 0 : -1
}
