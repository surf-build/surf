import path from 'path';

import {spawnPromise} from 'spawn-rx';
import {statNoException} from './promise-array';
import { fs } from './promisify';

async function git(cwd, ...params) {
  return spawnPromise('git', params, { cwd });
}

async function gitRemote(cwd, token, ...params) {
  let env = Object.assign({
    'GIT_ASKPASS': 'node -e "console.log(process.env.THE_PASSWORD)"',
    'THE_PASSWORD': token || ''
  }, process.env);

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
    await git('.', token, 'clone', url, targetDirname);
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
  if (await statNoException(checkoutDir) && await statNoException(path.join(checkoutDir, '.git'))) {
    return await fetchRepo(checkoutDir, token, false);
  } else {
    return await cloneRepo(url, checkoutDir, token);
  }
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