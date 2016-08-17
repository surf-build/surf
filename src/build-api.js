import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import {Observable} from 'rxjs';

import findActualExecutable from './find-actual-executable';
import { asyncReduce } from './promise-array';
import { spawnDetached } from 'spawn-rx';
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
  let activeDiscoverers = [];

  let mainDiscoverer = await asyncReduce(discoverers, async (acc, x) => {
    let affinity = await x.getAffinityForRootDir();
    if (affinity < 1) return acc;
    
    if (x.shouldAlwaysRun) {
      activeDiscoverers.push({ affinity, discoverer: x});
      return acc;
    }

    return (acc.affinity < affinity) ?
      { affinity, discoverer: x } :
      acc;
  }, {affinity: -1, discoverer: null});
  
  if (mainDiscoverer.discoverer) {
    activeDiscoverers.push(mainDiscoverer);
  }
  
  activeDiscoverers = _.sortBy(activeDiscoverers, (x) => 0 - x.affinity);
  
  if (activeDiscoverers.length < 1) {
    throw new Error("We can't figure out how to build this repo automatically.");
  }
  
  let ret = {
    cmds: [],
    artifactDirs: []
  };
  
  for (let {discoverer} of activeDiscoverers) {
    let thisCmd = await discoverer.getBuildCommand(sha);
    
    d(`Discoverer returned ${JSON.stringify(thisCmd)}`);
    if (thisCmd.cmds) {
      let newCmds = _.map(thisCmd.cmds, (x) => findActualExecutable(x.cmd, x.args));
      ret.cmds.push(...newCmds);
    } else {
      ret.cmds.push(findActualExecutable(thisCmd.cmd, thisCmd.args));
    }
    
    if (thisCmd.artifactDirs) {
      ret.artifactDirs.push(...thisCmd.artifactDirs);
    }
  }
  
  _.each(ret.cmds, (x) => d(`Actual executable to run: ${x.cmd} ${x.args.join(' ')}`));
  return ret;
}

export function runAllBuildCommands(cmds, rootDir, sha, tempDir) {
  return Observable.concat(_.map(cmds, ({cmd, args}) => {
    return Observable.defer(() => runBuildCommand(cmd, args, rootDir, sha, tempDir));
  })).publish().refCount();
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
