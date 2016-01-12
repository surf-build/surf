import crypto from 'crypto';
import path from 'path';

import { Repository, FetchOptions, Clone, CloneOptions, Checkout, CheckoutOptions } from 'nodegit';
import { rimraf, mkdirp, fs } from './promisify';

const d = require('debug')('serf:git-api');

export async function getHeadForRepo(targetDirname) {
  let repo = await Repository.open(targetDirname);
  let commit = await repo.getHeadCommit();

  return commit.sha;
}

export async function checkoutSha(targetDirname, sha) {
  let repo = await Repository.open(targetDirname);
  let commit = await repo.getCommit(sha);

  let opts = new CheckoutOptions();

  // Equivalent of `git reset --hard HEAD && git clean -xdf`
  d(`Found commit: ${targetDirname}:${commit.sha()}`);
  opts.checkoutStrategy = opts.checkoutStrategy |
    Checkout.STRATEGY.FORCE |
    Checkout.STRATEGY.RECREATE_MISSING |
    Checkout.STRATEGY.REMOVE_UNTRACKED |
    Checkout.STRATEGY.USE_THEIRS;

  await Checkout.tree(repo, commit, opts);
}

export async function updateRefspecToPullPRs(targetDirname) {
  let config = path.join(targetDirname, 'config');
  let contents = await fs.readFile(config, 'utf8');

  contents += `
[remote "origin"]
fetch = +refs/heads/*:refs/remotes/origin/*
fetch = +refs/pull/*/head:refs/remotes/origin/pr/*`;

  await fs.writeFile(config, contents);
}

export async function cloneRepo(url, targetDirname, token=null, bare=true) {
  let opts = new CloneOptions();
  opts.bare = bare ? 1 : 0;

  d(`Cloning ${url} => ${targetDirname}, bare=${bare}`);
  await Clone.clone(url, targetDirname, opts);

  if (bare) updateRefspecToPullPRs(targetDirname);

  await fetchRepo(targetDirname, token, bare);
}

export async function fetchRepo(targetDirname, token=null, bare=true) {
  let repo = bare ?
    await Repository.openBare(targetDirname) :
    await Repository.open(targetDirname);

  d(`Fetching all refs for ${targetDirname}`);
  let fo = new FetchOptions();
  fo.downloadTags = 1;

  await repo.fetchAll(fo);
}

export async function cloneOrFetchRepo(url, checkoutDir, token=null) {
  let dirname = crypto.createHash('sha1').update(url).digest('hex');
  let targetDirname = path.join(checkoutDir, dirname);

  try {
    await fetchRepo(targetDirname, token);
    return targetDirname;
  } catch (e) {
    console.error(`Failed to open bare repository, going to clone instead: ${e.message}`);
    d(e.stack);
  }

  await rimraf(targetDirname);
  await mkdirp(targetDirname);

  await cloneRepo(url, targetDirname, token);
  return targetDirname;
}
