import crypto from 'crypto';
import path from 'path';

import _ from 'lodash';
import pify from 'pify';
import {Repository, FetchOptions, Clone, CloneOptions} from 'nodegit';

const [rimraf, mkdirp] = _.map(['rimraf', 'mkdirp'], (x) => pify(require(x)));

const d = require('debug')('serf:git-api');

export async function cloneRepo(url, targetDirname, token=null) {
  let opts = new CloneOptions();
  opts.bare = 1;

  await Clone.clone(url, targetDirname, opts);
}

export async function fetchRepo(targetDirname, token=null) {
  let repo = await Repository.openBare(targetDirname);
  await repo.fetchAll(new FetchOptions());
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
