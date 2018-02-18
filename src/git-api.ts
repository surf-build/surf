import * as crypto from 'crypto';
import * as path from 'path';
import * as sfs from 'fs-extra';

import { GitProcess } from 'dugite';

import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';
import { statNoException, statSyncNoException } from './promise-array';
import { rimraf, mkdirp, mkdirpSync } from './recursive-fs';

import * as fs from 'mz/fs';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:git-api');

export async function git(args: string[], cwd: string, token?: string): Promise<string> {
  token = token || process.env.GITHUB_TOKEN;
  process.env.GIT_ASKPASS = 'envvar';
  process.env.GITCREDENTIALUSERNAME = 'token';
  process.env.GITCREDENTIALPASSWORD = token;

  let ret = await GitProcess.exec(args, cwd);
  if (ret.exitCode !== 0) {
    throw new Error(ret.stderr);
  }

  return ret.stdout.trim();
}

export function getHeadForRepo(targetDirname: string) {
  return git(['rev-parse', 'HEAD'], targetDirname);
}

export function getOriginForRepo(targetDirname: string) {
  return git(['remote', 'get-url', 'origin'], targetDirname);
}

export async function getOriginDefaultBranchName(targetDirname: string, token?: string) {
  const ret = await git(['rev-parse', 'symbolic-full-name', 'origin/HEAD'], targetDirname, token);
  return ret.replace('refs/heads/', '');
}

export async function getAllWorkdirs(repoUrl: string) {
  let tmp = process.env.SURF_ORIGINAL_TMPDIR || process.env.TMPDIR || process.env.TEMP || '/tmp';
  let ret = await fs.readdir(tmp);

  return ret.reduce((acc: string[], x) => {
    let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
    if (x.match(/^surfg-/i)) {
      let tgt = path.join(tmp, x);
      let stats = fs.statSync(tgt);
      let now = new Date();

      if ((now.getTime() - stats.mtime.getTime()) > 1000 * 60 * 60 * 2) {
        acc.push(path.join(tmp, x));
      }

      return acc;
    }

    if (!x.match(/-[a-f0-9A-F]{6}/i)) return acc;
    if (x.indexOf(`${nwo}-`) < 0) return acc;

    acc.push(path.join(tmp, x));
    return acc;
  }, []);
}

export function parseGitDiffOutput(output: string): string[] {
  return output.split('\n')
    .filter(line => line.length > 1)
    .map(line => {
      let pathSegment = line.split('\t')[2];
      if (pathSegment.indexOf('{') < 0) return pathSegment;

      // Fix up renames, which are of the format:
      // src/job-installers/{systemd.js => systemd.ts}
      return pathSegment.replace(/(.*){.*=> (.*)}$/, '$1$2');
    });
}

export async function getChangedFiles(targetDirname: string, token?: string): Promise<string[]> {
  token = token || process.env.GITHUB_TOKEN;

  let ourCommit = (await getHeadForRepo(targetDirname));
  d(`Got our commit: ${ourCommit}`);
  let defaultRemoteBranch = await getOriginDefaultBranchName(targetDirname, token);

  d(`Using origin/${defaultRemoteBranch} as remote default branch`);
  let remoteHeadCommit = await git(['rev-parse', `origin/${defaultRemoteBranch}`], targetDirname);

  // If we're on the remote master branch, there are no changes,
  // so just return every file
  if (ourCommit === remoteHeadCommit) {
    return (await git(['ls-files'], targetDirname))
      .split('\n')
      .filter(x => x.length > 1);
  }

  return parseGitDiffOutput(await git(['diff', '--numstat', 'origin/HEAD...HEAD'], targetDirname));
}

export function getWorkdirForRepoUrl(repoUrl: string, sha: string, dontCreate = false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `${nwo}-${shortSha}`);

  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `${nwo}-${shortSha}-${date}`);
  }

  if (!dontCreate) mkdirpSync(ret);
  return ret;
}

export function getTempdirForRepoUrl(repoUrl: string, sha: string, dontCreate = false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `t-${nwo}-${shortSha}`);
  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `t-${nwo}-${shortSha}-${date}`);
  }

  if (!dontCreate) mkdirpSync(ret);
  return ret;
}

export function getGistTempdir(id: string) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `surfg-${id}-${date}`);
  return ret;
}

export async function checkoutSha(targetDirname: string, sha: string) {
  await git(['checkout', '-f', sha], targetDirname);
  await git(['reset', '--hard', 'HEAD'], targetDirname);
  await git(['clean', '-xdf'], targetDirname);
}

//export function updateRefspecToPullPRs(repository: any) {
//  Remote.addFetch(repository, 'origin', '+refs/pull/*/head:refs/remotes/origin/pr/*');
//}

export async function cloneRepo(url: string, targetDirname: string, token?: string, bare = true) {
  if (!token) {
    d('GitHub token not set, only public repos will work!');
  }

  d(`Cloning ${url} => ${targetDirname}, bare=${bare}`);
  await git(
    ['clone', bare ? '--bare' : '--recurse-submodules', url, targetDirname],
    '.', token);

  await fetchRepo(targetDirname, token);
  return targetDirname;
}

export async function fetchRepo(targetDirname: string, token?: string) {
  d(`Fetching all refs for ${targetDirname}`);

  if (!token) {
    d('GitHub token not set, only public repos will work!');
  }

  let args = ['fetch', 'origin'];
  await git(args, targetDirname);

  // Fetch PRs too
  args.push('+refs/pull/*/head:refs/remotes/origin/pr/*');
  await git(args, targetDirname);
}

export async function cloneOrFetchRepo(url: string, checkoutDir: string, token?: string) {
  let dirname = crypto.createHash('sha1').update(url).digest('hex');
  let targetDirname = path.join(checkoutDir, dirname);

  try {
    await fetchRepo(targetDirname, token);
    return targetDirname;
  } catch (e) {
    d(`Failed to open bare repository, going to clone instead: ${e.message}`);
    d(e.stack);
  }

  await rimraf(targetDirname);
  await mkdirp(targetDirname);

  await cloneRepo(url, targetDirname, token);
  return targetDirname;
}

export async function resetOriginUrl(targetDirname: string, url: string) {
  await git(['remote', 'set-url', 'origin', url], targetDirname);
}

export async function addFilesToGist(repoUrl: string, targetDirname: string, artifactDirOrFile: string, token?: string) {
  if (!(await statNoException(targetDirname))) {
    d(`${targetDirname} doesn't exist, cloning it`);
    await mkdirp(targetDirname);
    await cloneRepo(repoUrl, targetDirname, token, false);
  }

  let stat = await fs.stat(artifactDirOrFile);
  if (stat.isFile()) {
    d(`Adding artifact directly as file: ${artifactDirOrFile}}`);
    let tgt = path.join(targetDirname, path.basename(artifactDirOrFile));
    sfs.copySync(artifactDirOrFile, tgt);

    d(`Adding artifact: ${tgt}`);
    await git(['add', path.basename(artifactDirOrFile)], targetDirname);
  } else {
    d('Reading artifacts directory');
    let artifacts = await fs.readdir(artifactDirOrFile);

    for (let entry of artifacts) {
      let tgt = path.join(targetDirname, entry);
      sfs.copySync(path.join(artifactDirOrFile, entry), tgt);

      d(`Adding artifact: ${tgt}`);
      await git(['add', tgt], targetDirname);
    }
  }

  d(`Writing commit to gist`);
  await git(['commit',
    '--author=Surf Build Server <none@example.com>',
    '--allow-empty-message',
  ], targetDirname);

  return targetDirname;
}

export async function pushGistRepoToMaster(targetDirname: string, token: string) {
  await git(['push', 'origin', 'master'], targetDirname, token);
}