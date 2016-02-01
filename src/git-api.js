import crypto from 'crypto';
import path from 'path';
import _ from 'lodash';

import { Repository, Clone, Checkout, Cred, Reference, Signature, Remote, enableThreadSafety } from 'nodegit';
import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';
import { rimraf, mkdirp, fs } from './promisify';
import { statNoException } from './promise-array';

enableThreadSafety();

const d = require('debug')('surf:git-api');

export async function getHeadForRepo(targetDirname) {
  let repoDir = await Repository.discover(targetDirname, 0, '');

  let repo = await Repository.open(repoDir);
  let commit = await repo.getHeadCommit();

  return commit.sha;
}

export async function getOriginForRepo(targetDirname) {
  let repoDir = await Repository.discover(targetDirname, 0, '');

  let repo = await Repository.open(repoDir);
  let origin = await Remote.lookup(repo, 'origin');
  return origin.pushurl() || origin.url();
}

export async function getAllWorkdirs(repoUrl) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let ret = await fs.readdir(tmp);

  return _.reduce(ret, (acc, x) => {
    let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
    if (!x.match(/^surf(tmp)?-/i)) return acc;
    if (!x.indexOf(`-${nwo}-`)) return acc;

    acc.push(path.join(tmp, x));
    return acc;
  }, []);
}

export function getWorkdirForRepoUrl(repoUrl, sha, dontCreate=false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `surf-${nwo}-${shortSha}-${date}`);
  if (!dontCreate) mkdirp.sync(ret);
  return ret;
}

export function getTempdirForRepoUrl(repoUrl, sha, dontCreate=false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `surft-${nwo}-${shortSha}-${date}`);
  if (!dontCreate) mkdirp.sync(ret);
  return ret;
}

export function getGistTempdir(id) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `surfg-${id}-${date}`);
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

export async function addFilesToGist(repoUrl, targetDir, artifactDir, token=null) {
  if (!(await statNoException(targetDir))) {
    d(`${targetDir} doesn't exist, cloning it`);
    await mkdirp(targetDir);
    await cloneRepo(repoUrl, targetDir, token, false);
  }

  d("Opening repo");
  let repo = await Repository.open(targetDir);

  d("Opening index");
  let idx = await repo.openIndex();
  await idx.read(1);

  d("Reading artifacts directory");
  let artifacts = await fs.readdir(artifactDir);
  for (let entry of artifacts) {
    let tgt = path.join(targetDir, entry);
    fs.copySync(path.join(artifactDir, entry), tgt);

    d(`Adding artifact: ${tgt}`);
    await idx.addByPath(entry);
  }

  await idx.write();
  let oid = await idx.writeTree();
  let head = await Reference.nameToId(repo, "HEAD");
  let parent = await repo.getCommit(head);

  d(`Writing commit to gist`);
  let now = new Date();
  let sig = await Signature.create("Surf Build Server", "none@example.com", now.getTime(), now.getTimezoneOffset());
  let sig2 = await Signature.create("Surf Build Server", "none@example.com", now.getTime(), now.getTimezoneOffset());

  d(`Creating commit`);
  await repo.createCommit("HEAD", sig, sig2, `Adding files from ${targetDir}`, oid, [parent]);

  return targetDir;
}

export async function pushGistRepoToMaster(targetDir, token) {
  d("Opening repo");
  let repo = await Repository.open(targetDir);

  d("Looking up origin");
  let origin = await Remote.lookup(repo, 'origin');

  let refspec = "refs/heads/master:refs/heads/master";
  let pushopts = {
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

  d("Pushing to Gist");
  await origin.push([refspec], pushopts);
}
