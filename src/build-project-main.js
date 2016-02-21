import path from 'path';
import mkdirp from 'mkdirp';
import { cloneOrFetchRepo, cloneRepo, checkoutSha, getWorkdirForRepoUrl, getTempdirForRepoUrl, getOriginForRepo, getHeadForRepo } from './git-api';
import { getSanitizedRepoUrl, getNwoFromRepoUrl, postCommitStatus, createGist } from './github-api';
import { determineBuildCommands, runAllBuildCommands, uploadBuildArtifacts } from './build-api';
import { fs, rimraf } from './promisify';

const d = require('debug')('surf:surf-build');

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

export default function main(argv, showHelp) {
  return realMain(argv, showHelp)
    .then(() => Promise.resolve(true), (e) => {
      if (argv.name) {
        let repo = argv.repo || process.env.SURF_REPO;
        let sha = argv.sha || process.env.SURF_SHA1;
        let nwo = getNwoFromRepoUrl(repo);

        return postCommitStatus(nwo, sha, 'error', 'Surf Build Server', null, argv.name)
          .catch(() => true)
          .then(() => Promise.reject(e));
      } else {
        return Promise.reject(e);
      }
    });
}

async function realMain(argv, showHelp) {
  let sha = argv.sha || process.env.SURF_SHA1;
  let repo = argv.repo || process.env.SURF_REPO;
  let name = argv.name;
  
  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (name === '__test__') {
    // NB: Don't end up setting statuses in unit tests, even if argv.name is set
    name = null;
  }

  let setRepoViaPwd = false;
  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
      argv.repo = repo;
      setRepoViaPwd = true;
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }
  
  if (!repo) {
    showHelp();
    process.exit(-1);
  }

  let repoDir = getRepoCloneDir();
  
  d(`Running initial cloneOrFetchRepo: ${repo} => ${repoDir}`);
  let bareRepoDir = await cloneOrFetchRepo(repo, repoDir);
  
  if (!sha) {
    try {
      sha = await getHeadForRepo(setRepoViaPwd ? '.' : bareRepoDir);
      argv.sha = sha;
    } catch (e) {
      console.error(`Failed to find the current commit for repo ${repo}: ${e.message}`);
      d(e.stack);

      showHelp();
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
  let { cmd, cmds, args, artifactDirs } = await determineBuildCommands(workDir);
  
  if (!cmds) {
    cmds = [{cmd, args}];
  }

  let buildPassed = false;
  let buildOutput = null;

  try {
    let buildStream = runAllBuildCommands(cmds, workDir, sha, tempDir);
    buildStream.subscribe((x) => console.log(x.replace(/[\r\n]+$/, '')), () => {});
    await buildStream.toPromise();
    
    buildPassed = true;
  } catch (e) {
    buildOutput = e.message;

    console.log(`\nError during build: ${e.message}`);
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
