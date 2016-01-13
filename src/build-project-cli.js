import './babel-maybefill';

import path from 'path';
import mkdirp from 'mkdirp';
import { toIso8601 } from 'iso8601';
import { cloneOrFetchRepo, cloneRepo, checkoutSha } from './git-api';
import { getNwoFromRepoUrl } from './github-api';
import { determineBuildCommand, runBuildCommand } from './build-api';

const d = require('debug')('serf:serf-build');

const yargs = require('yargs')
  .describe('repo', 'The repository to clone')
  .alias('s', 'sha')
  .describe('sha', 'The sha to build');

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

function getWorkdirForRepoUrl(repoUrl, sha) {
  let tmp = process.env.TMPDIR || process.env.TEMP || '/tmp';
  let nwo = getNwoFromRepoUrl(repoUrl).replace('/', '-');
  let date = toIso8601(new Date()).replace(/:/g, '.');

  let ret = path.join(tmp, `serf-workdir-${nwo}-${sha}-${date}`);
  mkdirp.sync(ret);
  return ret;
}

async function main() {
  // Checkout a bare repo to $SECRET_DIR if necessary
  // Clone a new copy to a work dir
  // Find a builder, run that shit
  // Copy artifacts to $ARTIFACTS_DIR

  let sha = argv.sha || process.env.SERF_SHA1;

  if (!argv.repo || !sha) {
    yargs.showHelp();
    process.exit(-1);
  }

  let repoDir = getRepoCloneDir();

  d(`Running initial cloneOrFetchRepo: ${argv.repo} => ${repoDir}`);
  let bareRepoDir = await cloneOrFetchRepo(argv.repo, repoDir);

  let workDir = getWorkdirForRepoUrl(argv.repo, sha);

  d(`Cloning to work directory: ${workDir}`);
  await cloneRepo(bareRepoDir, workDir, null, false);

  d(`Checking out to given SHA1: ${sha}`);
  await checkoutSha(workDir, sha);

  d(`Determining command to build`);
  let { cmd, args } = await determineBuildCommand(workDir);

  d(`Running ${cmd} ${args.join(' ')}...`);
  console.log(await runBuildCommand(cmd, args, workDir, sha));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  });
