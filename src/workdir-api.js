import path from 'path';

import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';
import { mkdirp, fs } from './promisify';
import { statSyncNoException } from './promise-array';

export async function getAllWorkdirs(repoUrl) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let ret = await fs.readdir(tmp);

  return ret.reduce((acc, x) => {
    let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
    if (!x.match(/-[a-f0-9A-F]{6}/i)) return acc;
    if (x.indexOf(`${nwo}-`) < 0) return acc;

    acc.push(path.join(tmp, x));
    return acc;
  }, []);
}

export function getWorkdirForRepoUrl(repoUrl, sha, dontCreate=false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `${nwo}-${shortSha}`);

  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `${nwo}-${shortSha}-${date}`);
  }

  if (!dontCreate) mkdirp.sync(ret);
  return ret;
}

export function getTempdirForRepoUrl(repoUrl, sha, dontCreate=false) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).split('/')[1];
  let date = toIso8601(new Date()).replace(/:/g, '.');
  let shortSha = sha.substr(0,6);

  let ret = path.join(tmp, `t-${nwo}-${shortSha}`);
  if (statSyncNoException(ret)) {
    ret = path.join(tmp, `t-${nwo}-${shortSha}-${date}`);
  }

  if (!dontCreate) mkdirp.sync(ret);
  return ret;
}

export function getGistTempdir(id) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `surfg-${id}-${date}`);
  return ret;
}