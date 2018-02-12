import * as crypto from 'crypto';
import * as path from 'path';
import * as sfs from 'fs-extra';

import { Repository, Clone, Checkout, Cred, Reference, Signature, Remote } from 'nodegit';
import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';
import { statNoException, statSyncNoException } from './promise-array';
import { rimraf, mkdirp, mkdirpSync } from './recursive-fs';

import * as fs from 'mz/fs';
import { spawnPromise } from 'spawn-rx';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:git-api');

type FreeMethod = ((f: any) => any);

function using<TRet>(block: (f: FreeMethod) => TRet): TRet {
  let toFree: any[] = [];

  try {
    return block((f) => { toFree.push(f); return f; });
  } finally {
    toFree.reverse().forEach((f) => f.free());
  }
}

export async function getHeadForRepo(targetDirname: string) {
  let repoDir = (await Repository.discover(targetDirname, 0, '')) as string;

  return await using(async (ds) => {
    let repo = ds(await Repository.open(repoDir));
    let commit = ds(await repo.getHeadCommit());
    return commit.sha();
  });
}

export async function getOriginForRepo(targetDirname: string) {
  let repoDir = await Repository.discover(targetDirname, 0, '');

  return await using(async (ds) => {
    let repo = ds(await Repository.open(repoDir));
    let origin = ds(await Remote.lookup(repo, 'origin', () => {}));

    return origin.pushurl() || origin.url();
  });
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

export async function getChangedFiles(targetDirname: string): Promise<string[]> {
  let repoDir = (await Repository.discover(targetDirname, 0, '')) as string;
  let opts = { cwd: repoDir };

  let ourCommit = await spawnPromise('git', ['rev-parse', 'HEAD'], opts);
  let remoteHeadCommit = await spawnPromise('git', ['rev-parse', 'origin/HEAD'], opts);

  // If we're on the remote master branch, there are no changes,
  // so just return every file
  if (ourCommit == remoteHeadCommit) {
    return (await spawnPromise('git', ['ls-files'], opts))
      .split('\n')
      .filter(x => x.length > 1);
  }

  return parseGitDiffOutput(
    await spawnPromise('git', ['diff', '--numstat', 'origin/HEAD...HEAD']));
}

export function getWorkdirForRepoUrl(repoUrl: string, sha: string, dontCreate= false) {
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

export function getTempdirForRepoUrl(repoUrl: string, sha: string, dontCreate= false) {
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
  return await using(async (ds) => {
    let repo = ds(await Repository.open(targetDirname));
    let commit = ds(await repo.getCommit(sha));

    let opts: any = {};

    // Equivalent of `git reset --hard HEAD && git clean -xdf`
    d(`Found commit: ${targetDirname}:${commit.sha()}`);
    opts.checkoutStrategy = Checkout.STRATEGY.FORCE |
      Checkout.STRATEGY.RECREATE_MISSING |
      Checkout.STRATEGY.REMOVE_UNTRACKED |
      Checkout.STRATEGY.USE_THEIRS;

    await Checkout.tree(repo, commit, opts);
  });
}

export function updateRefspecToPullPRs(repository: any) {
  Remote.addFetch(repository, 'origin', '+refs/pull/*/head:refs/remotes/origin/pr/*');
}

export async function cloneRepo(url: string, targetDirname: string, token?: string, bare = true) {
  token = token || process.env.GITHUB_TOKEN;
  let opts = {
    bare: bare ? 1 : 0,
    fetchOpts: {
      callbacks: {
        credentials: () => {
          d(`Returning ${token} for authentication token`);
          return Cred.userpassPlaintextNew(token || '', 'x-oauth-basic');
        },
        certificateCheck: () => {
          // Yolo
          return 1;
        }
      }
    }
  };

  if (!token) {
    d('GitHub token not set, only public repos will work!');
    delete opts.fetchOpts;
  }

  d(`Cloning ${url} => ${targetDirname}, bare=${bare}`);
  return await using(async (ds) => {
    let repo = await Clone.clone(url, targetDirname, opts);

    if (bare) updateRefspecToPullPRs(repo);

    ds(await fetchRepo(targetDirname, token, bare));
    return repo;
  });
}

export async function fetchRepo(targetDirname: string, token?: string, bare = true) {
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
        return Cred.userpassPlaintextNew(token || '', 'x-oauth-basic');
      },
      certificateCheck: () => {
        // Yolo
        return 1;
      }
    }
  };

  if (!token) {
    d('GitHub token not set, only public repos will work!');
    delete fo.callbacks;
  }

  await repo.fetchAll(fo, () => {});
  return repo;
}

export async function cloneOrFetchRepo(url: string, checkoutDir: string, token?: string) {
  let dirname = crypto.createHash('sha1').update(url).digest('hex');
  let targetDirname = path.join(checkoutDir, dirname);
  let r = null;

  try {
    r = await fetchRepo(targetDirname, token);
    r.free();

    return targetDirname;
  } catch (e) {
    d(`Failed to open bare repository, going to clone instead: ${e.message}`);
    d(e.stack);
  }

  await rimraf(targetDirname);
  await mkdirp(targetDirname);

  r = await cloneRepo(url, targetDirname, token);
  r.free();

  return targetDirname;
}

export async function resetOriginUrl(target: string, url: string) {
  await using(async (ds) => {
    let repo = ds(await Repository.open(target));
    Remote.setUrl(repo, 'origin', url);
  });
}

export async function addFilesToGist(repoUrl: string, targetDir: string, artifactDirOrFile: string, token?: string) {
  return await using(async (ds) => {
    if (!(await statNoException(targetDir))) {
      d(`${targetDir} doesn't exist, cloning it`);
      await mkdirp(targetDir);
      ds(await cloneRepo(repoUrl, targetDir, token, false));
    }

    d('Opening repo');
    let repo = ds(await Repository.open(targetDir));

    d('Opening index');
    let idx = await repo.index();
    await idx.read(1);

    let stat = await fs.stat(artifactDirOrFile);
    if (stat.isFile()) {
      d(`Adding artifact directly as file: ${artifactDirOrFile}}`);
      let tgt = path.join(targetDir, path.basename(artifactDirOrFile));
      sfs.copySync(artifactDirOrFile, tgt);

      d(`Adding artifact: ${tgt}`);
      await idx.addByPath(path.basename(artifactDirOrFile));
    } else {
      d('Reading artifacts directory');
      let artifacts = await fs.readdir(artifactDirOrFile);
      for (let entry of artifacts) {
        let tgt = path.join(targetDir, entry);
        sfs.copySync(path.join(artifactDirOrFile, entry), tgt);

        d(`Adding artifact: ${tgt}`);
        await idx.addByPath(entry);
      }
    }

    await idx.write();
    let oid = await idx.writeTree();
    let head = await Reference.nameToId(repo, 'HEAD');
    let parent = ds(await repo.getCommit(head));

    d(`Writing commit to gist`);
    let now = new Date();
    let sig = ds(await Signature.create('Surf Build Server', 'none@example.com', now.getTime(), now.getTimezoneOffset()));
    let sig2 = ds(await Signature.create('Surf Build Server', 'none@example.com', now.getTime(), now.getTimezoneOffset()));

    d(`Creating commit`);
    await repo.createCommit('HEAD', sig, sig2, `Adding files from ${targetDir}`, oid, [parent]);

    return targetDir;
  });
}

export async function pushGistRepoToMaster(targetDir: string, token: string) {
  return await using(async (ds) => {
    d('Opening repo');
    let repo = ds(await Repository.open(targetDir));

    d('Looking up origin');
    let origin = await Remote.lookup(repo, 'origin', () => {});

    let refspec = 'refs/heads/master:refs/heads/master';
    let pushopts: any = {
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

    d('Pushing to Gist');
    await origin.push([refspec], pushopts, () => {});
  });
}
