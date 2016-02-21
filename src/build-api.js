import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import {Observable} from 'rx';

import findActualExecutable from './find-actual-executable';
import { asyncReduce, spawnDetached } from './promise-array';
import { addFilesToGist, getGistTempdir, pushGistRepoToMaster } from './git-api';

const d = require('debug')('surf:build-api');

export function createBuildDiscovers(rootPath) {
  let discoverClasses = fs.readdirSync(path.join(__dirname, 'build-discoverers'));
  
  return _.map(discoverClasses, (file) => {
    const Klass = require(path.join(__dirname, 'build-discoverers', file)).default;

    d(`Found build discoverer: ${Klass.name}`);
    return new Klass(rootPath);
  });
}

export async function determineBuildCommands(rootPath, sha) {
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
  if (ret.cmds) {
    ret.cmds = _.map(ret.cmds, (x) => findActualExecutable(x.cmd, x.args));
  } else {
    _.assign(ret, findActualExecutable(ret.cmd, ret.args));
  }

  if (ret.cmds) {
    _.each(ret.cmds, (x) => d(`Actual executable to run: ${x.cmd} ${x.args.join(' ')}`));
  } else {
    d(`Actual executable to run: ${ret.cmd} ${ret.args.join(' ')}`);
  }

  return ret;
}

export function runAllBuildCommands(cmds, rootDir, sha, tempDir) {
  return Observable.concat(_.map(cmds, ({cmd, args}) => {
    return Observable.defer(() => runBuildCommand(cmd, args, rootDir, sha, tempDir));
  }));
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

  d(`Running ${cmd} ${args.join(' ')}...`);
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
