import './babel-maybefill';

import path from 'path';
import mkdirp from 'mkdirp';
import { toIso8601 } from 'iso8601';
import { cloneOrFetchRepo, cloneRepo, checkoutSha } from './git-api';
import { getNwoFromRepoUrl, postCommitStatus } from './github-api';
import { determineBuildCommand, runBuildCommand } from './build-api';

const d = require('debug')('serf:serf-build');

const yargs = require('yargs')
  .describe('repo', 'The repository to clone')
  .alias('s', 'sha')
  .describe('sha', 'The sha to build')
  .alias('n', 'name')
  .describe('name', 'The name to give this build on GitHub');

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

  if (argv.name) {
    d(`Posting 'pending' to GitHub status`);

    let nwo = getNwoFromRepoUrl(argv.repo);
    await postCommitStatus(nwo, sha, 
      'pending', 'Serf Build Server', 'http://butt.industries', argv.name);
  }

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
  let buildPassed = false;
  try {
    console.log(await runBuildCommand(cmd, args, workDir, sha));
    buildPassed = true;
  } catch (e) {
    console.log(`Error during build: ${e.message}`);
    d(e.stack);
  }

  if (argv.name) {
    d(`Posting 'success' to GitHub status`);

    let nwo = getNwoFromRepoUrl(argv.repo);
    await postCommitStatus(nwo, sha, 
      buildPassed ? 'success' : 'failure', 'Serf Build Server', 'http://butt.industries', argv.name);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    if (argv.name) {
      let nwo = getNwoFromRepoUrl(argv.repo);
      let sha = argv.sha || process.env.SERF_SHA1;

      postCommitStatus(nwo, sha, 'error', 'Serf Build Server', 'http://butt.industries', argv.name)
        .catch(() => true)
        .then(() => process.exit(-1));
    } else {
      process.exit(-1);
    }
  });
