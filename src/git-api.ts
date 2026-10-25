import * as crypto from 'node:crypto'
import { cpSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import createDebug from 'debug'
import { findActualExecutable, spawnPromise } from 'spawn-rx'
import { getNwoFromRepoUrl } from './github-api'
import { statNoException, statSyncNoException } from './promise-array'
import { mkdirp, mkdirpSync, rimraf } from './recursive-fs'

const d = createDebug('surf:git-api')

let askPassPath: string | undefined

// GIT_ASKPASS has to be an executable we can actually run: resolving through
// PATH only works when the global install prepended its node_modules dir, so a
// local build/src run ends up with "cannot run git-askpass-env".
function resolveAskPassPath(): string | undefined {
  if (askPassPath) return askPassPath

  try {
    askPassPath = createRequire(import.meta.url).resolve('git-askpass-env/lib/index.js')
    return askPassPath
  } catch (e) {
    d(`Failed to resolve git-askpass-env, falling back to PATH: ${(e as Error).message}`)
  }

  try {
    askPassPath = findActualExecutable('git-askpass-env', []).cmd
  } catch (e) {
    d(`Could not find git-askpass-env at all: ${(e as Error).message}`)
  }

  return askPassPath
}

export async function git(args: string[], cwd: string, token?: string): Promise<string> {
  const ourToken = token || process.env.GITHUB_TOKEN
  const askPass = resolveAskPassPath()

  d(`Actually using token! ${ourToken}`)
  if (askPass) {
    process.env.GIT_ASKPASS = askPass
    d(`Using askpass helper: ${askPass}`)
  } else {
    delete process.env.GIT_ASKPASS
  }

  process.env.GIT_ASKPASS_USER = ourToken
  process.env.GIT_ASKPASS_PASSWORD = 'x-oauth-basic'

  // Any credential.helper configured on the machine (gh, manager, osxkeychain,
  // store) is consulted *before* GIT_ASKPASS, so the token above would be
  // silently ignored and git would push as whatever account the helper knows.
  // Wipe the helper list per invocation so the token we were given is the one
  // git actually uses.
  const finalArgs = ourToken ? ['-c', 'credential.helper=', ...args] : args

  d(`Running command: git ${args.join(' ')} in ${cwd}`)
  const output = await spawnPromise('git', finalArgs, { cwd })
  return output.trim()
}

export function getHeadForRepo(targetDirname: string) {
  return git(['rev-parse', 'HEAD'], targetDirname)
}

// `--sha` is documented as a SHA1 but people pass branch and tag names too (and
// surf-run used to hand us whatever a ref pointed at). Resolve everything to a
// full commit SHA up front, because that is the only thing the GitHub status API
// reliably accepts: a bare branch name there is a 404, which is why `-s branch`
// worked without `-n` and failed with it.
export async function resolveRefToSha(targetDirname: string, ref: string, token?: string) {
  const candidates = [ref, `refs/heads/${ref}`, `refs/remotes/origin/${ref}`, `refs/tags/${ref}`]

  for (const candidate of candidates) {
    try {
      const ret = await git(['rev-parse', '--verify', `${candidate}^{commit}`], targetDirname, token)
      if (/^[0-9a-f]{40,64}$/i.test(ret)) return ret
    } catch (e) {
      d(`'${candidate}' does not resolve to a commit in ${targetDirname}: ${e.message}`)
    }
  }

  throw new Error(`'${ref}' is not a commit, branch, or tag in ${targetDirname}`)
}

export function getDefaultBranchForRepo(targetDirname: string, token?: string) {
  return git(['symbolic-ref', '--short', 'HEAD'], targetDirname, token)
}

export function getOriginForRepo(targetDirname: string) {
  return git(['remote', 'get-url', 'origin'], targetDirname)
}

export async function getOriginDefaultBranchName(targetDirname: string, token?: string) {
  const ret = await git(['rev-parse', 'symbolic-full-name', 'origin/HEAD'], targetDirname, token)
  return ret.replace('refs/heads/', '')
}

export async function getAllWorkdirs(repoUrl: string) {
  const tmp = process.env.SURF_ORIGINAL_TMPDIR || process.env.TMPDIR || process.env.TEMP || '/tmp'
  const ret = await readdir(tmp)

  return ret.reduce((acc: string[], x) => {
    const nwo = getNwoFromRepoUrl(repoUrl).split('/')[1]
    if (x.match(/^surfg-/i)) {
      const tgt = path.join(tmp, x)
      const stats = statSync(tgt)
      const now = new Date()

      if (now.getTime() - stats.mtime.getTime() > 1000 * 60 * 60 * 2) {
        acc.push(path.join(tmp, x))
      }

      return acc
    }

    if (!x.match(/-[a-f0-9A-F]{6}/i)) return acc
    if (x.indexOf(`${nwo}-`) < 0) return acc

    acc.push(path.join(tmp, x))
    return acc
  }, [])
}

export function parseGitDiffOutput(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.length > 1)
    .map((line) => {
      const pathSegment = line.split('\t')[2]
      if (pathSegment.indexOf('{') < 0) return pathSegment

      // Fix up renames, which are of the format:
      // src/job-installers/{systemd.js => systemd.ts}
      return pathSegment.replace(/(.*){.*=> (.*)}$/, '$1$2')
    })
}

export async function getChangedFiles(targetDirname: string, token?: string): Promise<string[]> {
  token = token || process.env.GITHUB_TOKEN

  const ourCommit = await getHeadForRepo(targetDirname)
  d(`Got our commit: ${ourCommit}`)
  const defaultRemoteBranch = await getOriginDefaultBranchName(targetDirname, token)

  d(`Using origin/${defaultRemoteBranch} as remote default branch`)
  const remoteHeadCommit = await git(['rev-parse', `origin/${defaultRemoteBranch}`], targetDirname)

  // If we're on the remote master branch, there are no changes,
  // so just return every file
  if (ourCommit === remoteHeadCommit) {
    return (await git(['ls-files'], targetDirname)).split('\n').filter((x) => x.length > 1)
  }

  return parseGitDiffOutput(await git(['diff', '--numstat', 'origin/HEAD...HEAD'], targetDirname))
}

export function getWorkdirForRepoUrl(repoUrl: string, sha: string, dontCreate = false) {
  const tmp = process.env.TMPDIR || process.env.TEMP || '/tmp'
  const nwo = getNwoFromRepoUrl(repoUrl).split('/')[1]
  const date = getSortableTimestamp()
  const shortSha = sha.substr(0, 6)

  let ret = path.join(tmp, `${nwo}-${shortSha}`)

  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `${nwo}-${shortSha}-${date}`)
  }

  if (!dontCreate) mkdirpSync(ret)
  return ret
}

export function getTempdirForRepoUrl(repoUrl: string, sha: string, dontCreate = false) {
  const tmp = process.env.TMPDIR || process.env.TEMP || '/tmp'
  const nwo = getNwoFromRepoUrl(repoUrl).split('/')[1]
  const date = getSortableTimestamp()
  const shortSha = sha.substr(0, 6)

  let ret = path.join(tmp, `t-${nwo}-${shortSha}`)
  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `t-${nwo}-${shortSha}-${date}`)
  }

  if (!dontCreate) mkdirpSync(ret)
  return ret
}

export function getGistTempdir(id: string) {
  const tmp = process.env.TMPDIR || process.env.TEMP || '/tmp'
  const date = getSortableTimestamp()

  const ret = path.join(tmp, `surfg-${id}-${date}`)
  return ret
}

export async function checkoutSha(targetDirname: string, sha: string) {
  await git(['checkout', '-f', sha], targetDirname)
  await git(['reset', '--hard', 'HEAD'], targetDirname)
  await git(['clean', '-xdf'], targetDirname)
}

//export function updateRefspecToPullPRs(repository: any) {
//  Remote.addFetch(repository, 'origin', '+refs/pull/*/head:refs/remotes/origin/pr/*');
//}

export async function cloneRepo(url: string, targetDirname: string, token?: string, bare = true) {
  if (!token) {
    d('GitHub token not set, only public repos will work!')
  }

  d(`Cloning ${url} => ${targetDirname}, bare=${bare}`)
  await git(['clone', bare ? '--bare' : '--recurse-submodules', url, targetDirname], process.cwd(), token)

  if (url.indexOf('gist.github') < 0) {
    d('Fetching PRs for repo')
    await fetchRepo(targetDirname, token)
  }

  return targetDirname
}

export async function fetchRepo(targetDirname: string, token?: string) {
  d(`Fetching all refs for ${targetDirname}`)

  if (!token) {
    d('GitHub token not set, only public repos will work!')
  }

  const args = ['fetch', 'origin']
  await git(args, targetDirname)

  // Fetch PRs too
  args.push('+refs/pull/*/head:refs/remotes/origin/pr/*')
  await git(args, targetDirname)
}

export async function cloneOrFetchRepo(url: string, checkoutDir: string, token?: string) {
  const dirname = crypto.createHash('sha1').update(url).digest('hex')
  const targetDirname = path.join(checkoutDir, dirname)

  try {
    await fetchRepo(targetDirname, token)
    return targetDirname
  } catch (e) {
    d(`Failed to open bare repository, going to clone instead: ${e.message}`)
    d(e.stack)
  }

  await rimraf(targetDirname)
  await mkdirp(targetDirname)

  await cloneRepo(url, targetDirname, token)
  return targetDirname
}

export async function resetOriginUrl(targetDirname: string, url: string) {
  await git(['remote', 'set-url', 'origin', url], targetDirname)
}

export async function addFilesToGist(
  repoUrl: string,
  targetDirname: string,
  artifactDirOrFile: string,
  token?: string,
  commit = true
) {
  if (!(await statNoException(targetDirname))) {
    d(`${targetDirname} doesn't exist, cloning it`)
    await mkdirp(targetDirname)
    await cloneRepo(repoUrl, targetDirname, token, false)
  }

  const statInfo = await stat(artifactDirOrFile)
  if (statInfo.isFile()) {
    d(`Adding artifact directly as file: ${artifactDirOrFile}`)
    const tgt = path.join(targetDirname, path.basename(artifactDirOrFile))
    cpSync(artifactDirOrFile, tgt)

    d(`Adding artifact: ${tgt}`)
    await git(['add', path.basename(tgt)], targetDirname)
  } else {
    d('Reading artifacts directory')
    const artifacts = await readdir(artifactDirOrFile)

    for (const entry of artifacts) {
      const tgt = path.join(targetDirname, entry)
      cpSync(path.join(artifactDirOrFile, entry), tgt)

      d(`Adding artifact: ${tgt}`)
      await git(['add', tgt], targetDirname)
    }
  }

  if (commit) {
    await commitGistChanges(targetDirname, token)
  }

  return targetDirname
}

export async function commitGistChanges(targetDirname: string, token?: string) {
  // Quoting inside the args is wrong for spawn (there is no shell to strip it),
  // so pass the author value verbatim.
  d(`Writing commit to gist`)
  await git(
    ['commit', '--author=Surf Build Server <none@example.com>', '--allow-empty', '-m', 'Add files'],
    targetDirname,
    token
  )
}

export async function pushGistRepoToMaster(targetDirname: string, token: string) {
  // Freshly created gists are on `main` today but used `master` historically;
  // push the branch we actually cloned instead of guessing.
  await git(['push', 'origin', 'HEAD'], targetDirname, token)
}

function getSortableTimestamp() {
  return new Date().toISOString().replace(/:/g, '.')
}
