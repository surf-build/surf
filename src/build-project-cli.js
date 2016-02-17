#!/usr/bin/env node

import './babel-maybefill';

import path from 'path';
import mkdirp from 'mkdirp';
import { cloneOrFetchRepo, cloneRepo, checkoutSha, getWorkdirForRepoUrl, getTempdirForRepoUrl, getOriginForRepo, getHeadForRepo } from './git-api';
import { getSanitizedRepoUrl, getNwoFromRepoUrl, postCommitStatus, createGist } from './github-api';
import { determineBuildCommand, runBuildCommand, uploadBuildArtifacts } from './build-api';
import { fs, rimraf } from './promisify';

const d = require('debug')('surf:surf-build');

const yargs = require('yargs')
  .usage(`Usage: surf-build -r http://github.com/some/repo -s SHA1
Clones a repo from GitHub and builds the given SHA1`)
  .alias('r', 'repo')
  .describe('repo', 'The repository to clone')
  .alias('s', 'sha')
  .describe('sha', 'The sha to build')
  .alias('n', 'name')
  .describe('name', 'The name to give this build on GitHub')
  .epilog(`
Some useful environment variables:

GITHUB_ENTERPRISE_URL - the GitHub Enterprise URL to (optionally) post status to.
GITHUB_TOKEN - the GitHub (.com or Enterprise) API token to use. Must be provided.
GIST_ENTERPRISE_URL - the GitHub Enterprise URL to (optionally) post Gists to.
GIST_TOKEN - the GitHub (.com or Enterprise) API token to use to create the build output Gist.

SURF_SHA1 - an alternate way to specify the --sha parameter, provided
            automatically by surf-client.
SURF_REPO - an alternate way to specify the --repo parameter, provided
            automatically by surf-client.`);

const argv = yargs.argv;

function getRootAppDir() {
  let ret = null;

  switch (process.platform) {
  case 'win32':
    ret = path.join(process.env.LOCALAPPDATA, 'surf');
    break;
  case 'darwin':
    ret = path.join(process.env.HOME, 'Library', 'Application Support', 'surf');
    break;
  default:
    ret = path.join(process.env.HOME, '.config', 'surf');
    break;
  }

  mkdirp.sync(ret);
  return ret;
}

function getRepoCloneDir() {
  return path.join(getRootAppDir(), 'repos');
}

export async function main(testSha=null, testRepo=null, testName=null) {
  let sha = testSha || argv.sha || process.env.SURF_SHA1;
  let repo = testRepo || argv.repo || process.env.SURF_REPO;
  let name = testName || argv.name;

  if (name === '__test__') {
    // NB: Don't end up setting statuses in unit tests, even if argv.name is set
    name = null;
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      yargs.showHelp();
      process.exit(-1);
    }
  }
  
  if (!repo) {
    yargs.showHelp();
    if (testSha || testRepo) {
      throw new Error("Would've Died");
    } else {
      process.exit(-1);
    }
  }

  let repoDir = getRepoCloneDir();
  
  d(`Running initial cloneOrFetchRepo: ${repo} => ${repoDir}`);
  let bareRepoDir = await cloneOrFetchRepo(repo, repoDir);
  
  if (!sha) {
    try {
      sha = await getHeadForRepo(bareRepoDir);
    } catch (e) {
      console.error(`Failed to find the current commit for repo ${repo}: ${e.message}`);
      d(e.stack);

      yargs.showHelp();
      process.exit(-1);
    }
  }

  d(`repo: ${repo}, sha: ${sha}`);
  
  if (name) {
    d(`Posting 'pending' to GitHub status`);

    let nwo = getNwoFromRepoUrl(repo);
    await postCommitStatus(nwo, sha,
      'pending', 'Surf Build Server', null, name);
  }
  
  let workDir = getWorkdirForRepoUrl(repo, sha);
  let tempDir = getTempdirForRepoUrl(repo, sha);

  d(`Cloning to work directory: ${workDir}`);
  await cloneRepo(bareRepoDir, workDir, null, false);

  d(`Checking out to given SHA1: ${sha}`);
  await checkoutSha(workDir, sha);

  d(`Determining command to build`);
  let { cmd, args, artifactDirs } = await determineBuildCommand(workDir);

  d(`Running ${cmd} ${args.join(' ')}...`);
  let buildPassed = false;
  let buildOutput = null;

  try {
    buildOutput = await runBuildCommand(cmd, args, workDir, sha, tempDir).toPromise();
    console.log(buildOutput);
    buildPassed = true;
  } catch (e) {
    buildOutput = e.message;

    console.log(`Error during build: ${e.message}`);
    d(e.stack);
  }

  await fs.writeFile(path.join(workDir, 'build-output.log'), buildOutput);

  if (name) {
    d(`Posting 'success' to GitHub status`);

    let gistInfo = await createGist(`Build completed: ${nwo}#${sha}, ${new Date()}`, {
      "build-output.txt": {
        content: buildOutput
      }
    });

    d(`Gist result: ${gistInfo.result.html_url}`);
    d(`Gist clone URL: ${gistInfo.result.git_pull_url}`);
    if (buildPassed) {
      let token = process.env.GIST_TOKEN || process.env.GITHUB_TOKEN;

      try {
        d(`Uploading build artifacts using token: ${token}`);
        let targetDir = await uploadBuildArtifacts(gistInfo.result.id, gistInfo.result.git_pull_url, artifactDirs, token);
        await rimraf(targetDir);
      } catch (e) {
        console.error(`Failed to upload build artifacts: ${e.message}`);
        d(e.stack);
      }
    }

    let nwo = getNwoFromRepoUrl(repo);
    await postCommitStatus(nwo, sha,
      buildPassed ? 'success' : 'failure', 'Surf Build Server', gistInfo.result.html_url, name);
  }

  if (buildPassed) {
    await rimraf(tempDir);
  }
}

if (process.mainModule === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.log(`Fatal Error: ${e.message}`);
      d(e.stack);

      if (argv.name) {
        let repo = argv.repo || process.env.SURF_REPO;
        let sha = argv.sha || process.env.SURF_SHA1;
        let nwo = getNwoFromRepoUrl(repo);

        postCommitStatus(nwo, sha, 'error', 'Surf Build Server', null, argv.name)
          .catch(() => true)
          .then(() => process.exit(-1));
      } else {
        process.exit(-1);
      }
    });
}
