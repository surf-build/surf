import './babel-maybefill';

import path from 'path';
import mkdirp from 'mkdirp';
import { cloneOrFetchRepo, cloneRepo } from './git-api';
import { getNwoFromRepoUrl } from './github-api';
import { toIso8601 } from 'iso8601';

const d = require('debug')('serf:serf-build');

const yargs = require('yargs')
  .alias('r', 'repo')
  .describe('repo', 'The repository to clone');

const argv = yargs.argv;

function getRootAppDir() {
  let ret = null;

  switch (process.platform) {
  case 'win32':
    ret = path.join(process.env.LOCALAPPDATA, 'serf');
    break;
  case 'darwin':
    ret = path.join(process.env.HOME, 'Library', 'Application Support', 'serf');
    break;
  default:
    ret = path.join(process.env.HOME, '.config', 'serf');
    break;
  }

  mkdirp.sync(ret);
  return ret;
}

function getRepoCloneDir() {
  return path.join(getRootAppDir(), 'repos');
}

function getWorkdirForRepoUrl(repoUrl, refName) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).replace('/', '-');
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `serf-workdir-${nwo}-${refName}-${date}`);
  mkdirp.sync(ret);
  return ret;
}

async function main() {
  // Checkout a bare repo to $SECRET_DIR if necessary
  // Clone a new copy to a work dir
  // Find a builder, run that shit
  // Copy artifacts to $ARTIFACTS_DIR

  if (!argv.repo) {
    yargs.showHelp();
    process.exit(-1);
  }

  let repoDir = getRepoCloneDir();

  d(`Running initial cloneOrFetchRepo: ${argv.repo} => ${repoDir}`);
  await cloneOrFetchRepo(argv.repo, repoDir);

  let workDir = getWorkdirForRepoUrl(argv.repo, 'master');

  d(`Cloning to work directory: ${workDir}`);
  await cloneRepo(argv.repo, workDir, null, false);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  });
