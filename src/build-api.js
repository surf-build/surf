import _ from 'lodash';
import findActualExecutable from './find-actual-executable';
import { asyncReduce, spawnDetached } from './promise-array';
import { addFilesToGist, getGistTempdir, pushGistRepoToMaster } from './git-api';

const d = require('debug')('surf:build-api');
const AllBuildDiscoverers = require('./build-discover-drivers');

export function createBuildDiscovers(rootPath) {
  return _.map(Object.keys(AllBuildDiscoverers), (key) => {
    const Klass = AllBuildDiscoverers[key];
    return new Klass(rootPath);
  });
}

export async function determineBuildCommand(rootPath, sha) {
  let discoverers = createBuildDiscovers(rootPath);

  let { discoverer } = await asyncReduce(discoverers, async (acc, x) => {
    let affinity = await x.getAffinityForRootDir();
    if (affinity < 1) return acc;

    return (acc.affinity < affinity) ?
      { affinity, discoverer: x } :
      acc;
  }, {affinity: -1, discoverer: null});

  if (!discoverer) {
    throw new Error("We can't figure out how to build this repo automatically.");
  }

  let ret = await discoverer.getBuildCommand(sha);
  _.assign(ret, findActualExecutable(ret.cmd, ret.args));

  d(`Actual executables to run: ${ret.cmd} ${ret.args.join(' ')}`);
  return ret;
}

export function runBuildCommand(cmd, args, rootDir, sha, tempDir) {
  let envToAdd = {
    'SURF_SHA1': sha,
    'TMPDIR': tempDir,
    'TEMP': tempDir,
    'TMP': tempDir
  };

  let opts = {
    cwd: rootDir,
    env: _.assign({}, process.env, envToAdd)
  };

  return spawnDetached(cmd, args, opts);
}

export async function uploadBuildArtifacts(gistId, gistCloneUrl, artifactDirs, token) {
  let targetDir = getGistTempdir(gistId);

  for (let artifactDir of artifactDirs) {
    await addFilesToGist(gistCloneUrl, targetDir, artifactDir, token);
  }

  await pushGistRepoToMaster(targetDir, token);
  return targetDir;
}
