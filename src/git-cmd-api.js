import path from 'path';
import crypto from 'crypto';

import {spawnPromise} from 'spawn-rx';
import { rimraf, mkdirp, fs } from './promisify';

const d = require('debug')('surf:git-api');

async function git(cwd, ...params) {
  return spawnPromise('git', params, { cwd });
}

async function gitRemote(cwd, token, ...params) {
  let env = Object.assign({
    'GIT_ASKPASS': 'node -e "console.log(process.env.THE_PASSWORD)"',
    'THE_PASSWORD': token || ''
  }, process.env);

  d(`Spawning git ${params.join(' ')}`);
  return spawnPromise('git', params, { cwd, env });
}

export function getHeadForRepo(targetDirname) {
  return git(targetDirname, 'rev-parse', 'HEAD');
}

export function getOriginForRepo(targetDirname) {
  return git(targetDirname, 'remote', 'get-url', 'origin');
}

export async function checkoutSha(targetDirname, sha, token=null) {
  await git(targetDirname, 'checkout', sha);
  await git(targetDirname, 'submodule', 'sync');
  await gitRemote(targetDirname, token, 'submodule', 'update', '--init', '--recursive');
}

export function updateRefspecToPullPRs() {
  // NB: No-op, we encode refspec in fetch command
}

export async function cloneRepo(url, targetDirname, token=null, bare=true) {
  if (bare) {
    await gitRemote('.', token, 'clone', '--bare', url, targetDirname);
  } else {
    await gitRemote('.', token, 'clone', url, targetDirname);
  }

  // Extra fetch to get PRs
  await fetchRepo(targetDirname, token);
  if (!bare) {
    await gitRemote(targetDirname, token, 'submodule', 'update', '--init', '--recursive');
  }
}

export async function fetchRepo(targetDirname, token=null) {
  await gitRemote(targetDirname, token, 'fetch', 'origin', '+refs/pull/*/head:refs/remotes/origin/pr/*');
}

export async function cloneOrFetchRepo(url, checkoutDir, token=null) {
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

export function resetOriginUrl(target, url) {
  return git(target, 'remote', 'set-url', 'origin', url);
}

export async function addFilesToGist(repoUrl, targetDir, artifactDir) {
  let artifacts = await fs.readdir(artifactDir);

  for (let entry of artifacts) {
    let tgt = path.join(targetDir, entry);
    fs.copySync(path.join(artifactDir, entry), tgt);
  }
    
  await git(targetDir, 'add', '-A');
  await git(targetDir, 'commit', '-a', '--author=Surf <none@example.com>', '-m', 'Add artifacts');
}

export async function pushGistRepoToMaster(targetDir, token) {
  await gitRemote(targetDir, token, 'push', '-u', 'origin', 'master');
}