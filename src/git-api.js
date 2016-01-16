import crypto from 'crypto';
import path from 'path';

import { Repository, Clone, Checkout, Cred } from 'nodegit';
import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';
import { rimraf, mkdirp, fs } from './promisify';

const d = require('debug')('serf:git-api');

export async function getHeadForRepo(targetDirname) {
  let repo = await Repository.open(targetDirname);
  let commit = await repo.getHeadCommit();

  return commit.sha;
}

export function getWorkdirForRepoUrl(repoUrl, sha) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).replace('/', '-');
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `serf-workdir-${nwo}-${sha}-${date}`);
  mkdirp.sync(ret);
  return ret;
}

export async function checkoutSha(targetDirname, sha) {
  let repo = await Repository.open(targetDirname);
  let commit = await repo.getCommit(sha);

  let opts = {};

  // Equivalent of `git reset --hard HEAD && git clean -xdf`
  d(`Found commit: ${targetDirname}:${commit.sha()}`);
  opts.checkoutStrategy = Checkout.STRATEGY.FORCE |
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
  token = token || process.env.GITHUB_TOKEN;
  let opts = {
    bare: bare ? 1 : 0,
    fetchOpts: {
      callbacks: {
        credentials: () => {
          d(`Returning ${token} for authentication token`);
          return Cred.userpassPlaintextNew(token, 'x-oauth-basic');
        },
        certificateCheck: () => {
          // Yolo
          return 1;
        }
      }
    }
  };
  
  if (!token) {
    d("GitHub token not set, only public repos will work!");
    delete opts.fetchOpts;
  }

  d(`Cloning ${url} => ${targetDirname}, bare=${bare}`);
  await Clone.clone(url, targetDirname, opts);

  if (bare) updateRefspecToPullPRs(targetDirname);

  await fetchRepo(targetDirname, token, bare);
}

export async function fetchRepo(targetDirname, token=null, bare=true) {
  token = token || process.env.GITHUB_TOKEN;
  let repo = bare ?
    await Repository.openBare(targetDirname) :
    await Repository.open(targetDirname);

  d(`Fetching all refs for ${targetDirname}`);
  let fo = {
    downloadTags: 1,
    callbacks: {
      credentials: () => {
        d(`Returning ${token} for authentication token`);
        return Cred.userpassPlaintextNew(token, 'x-oauth-basic');
      },
      certificateCheck: () => {
        // Yolo
        return 1;
      }
    }  
  };
  
  if (!token) {
    d("GitHub token not set, only public repos will work!");
    delete fo.callbacks;
  }
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
