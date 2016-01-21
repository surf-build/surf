#!/usr/bin/env node

import './babel-maybefill';

import path from 'path';
import mkdirp from 'mkdirp';
import fs from 'fs';
import { cloneOrFetchRepo, cloneRepo, checkoutSha, getWorkdirForRepoUrl } from './git-api';
import { getNwoFromRepoUrl, postCommitStatus, createGist } from './github-api';
import { determineBuildCommand, runBuildCommand } from './build-api';

const d = require('debug')('serf:serf-build');

const yargs = require('yargs')
  .usage(`Usage: serf-build --repo http://github.com/some/repo -s SHA1
Clones a repo from GitHub and builds the given SHA1`)
  .describe('repo', 'The repository to clone')
  .alias('s', 'sha')
  .describe('sha', 'The sha to build')
  .alias('n', 'name')
  .describe('name', 'The name to give this build on GitHub')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to post status to.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.
GIST_TOKEN - the GitHub API token to use to create the build output Gist.
GIST_ENTERPRISE_URL - the GitHub Enterprise URL to post Gists to.

SERF_SHA1 - an alternate way to specify the --sha parameter, provided
            automatically by serf-client.
SERF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by serf-client.`);

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
async function main() {
  let sha = argv.sha || process.env.SERF_SHA1;
  let repo = argv.repo || process.env.SERF_REPO;

  if (!repo || !sha) {
    yargs.showHelp();
    process.exit(-1);
  }

  let repoDir = getRepoCloneDir();

  if (argv.name) {
    d(`Posting 'pending' to GitHub status`);

    let nwo = getNwoFromRepoUrl(repo);
    await postCommitStatus(nwo, sha,
      'pending', 'Serf Build Server', null, argv.name);
  }

  d(`Running initial cloneOrFetchRepo: ${repo} => ${repoDir}`);
  let bareRepoDir = await cloneOrFetchRepo(repo, repoDir);

  let workDir = getWorkdirForRepoUrl(repo, sha);

  d(`Cloning to work directory: ${workDir}`);
  await cloneRepo(bareRepoDir, workDir, null, false);

  d(`Checking out to given SHA1: ${sha}`);
  await checkoutSha(workDir, sha);

  d(`Determining command to build`);
  let { cmd, args } = await determineBuildCommand(workDir);

  d(`Running ${cmd} ${args.join(' ')}...`);
  let buildPassed = false;
  let buildOutput = null;

  try {
    buildOutput = await runBuildCommand(cmd, args, workDir, sha).toPromise();
    console.log(buildOutput);
    buildPassed = true;
  } catch (e) {
    buildOutput = e.message;

    console.log(`Error during build: ${e.message}`);
    d(e.stack);
  }
  
  fs.writeFileSync(path.join(workDir, 'build-output.log'), buildOutput);

  if (argv.name) {
    d(`Posting 'success' to GitHub status`);

    let gistInfo = await createGist(`Build completed: ${nwo}#${sha}, ${new Date()}`, {
      "build-output.txt": {
        content: buildOutput
      }
    });

    let nwo = getNwoFromRepoUrl(repo);
    await postCommitStatus(nwo, sha,
      buildPassed ? 'success' : 'failure', 'Serf Build Server', gistInfo.result.html_url, argv.name);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);

    if (argv.name) {
      let repo = argv.repo || process.env.SERF_REPO;
      let sha = argv.sha || process.env.SERF_SHA1;
      let nwo = getNwoFromRepoUrl(repo);

      postCommitStatus(nwo, sha, 'error', 'Serf Build Server', null, argv.name)
        .catch(() => true)
        .then(() => process.exit(-1));
    } else {
      process.exit(-1);
    }
  });
