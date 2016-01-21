import _ from 'lodash';
import findActualExecutable from './find-actual-executable';
import { asyncReduce, spawnDetached } from './promise-array';

const d = require('debug')('serf:build-api');
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
  
  let { cmd, args } = await discoverer.getBuildCommand(sha);
  let ret = findActualExecutable(cmd, args);
  
  d(`Actual executables to run: ${ret.cmd} ${ret.args.join(' ')}`);
  return ret;
}

export function runBuildCommand(cmd, args, rootDir, sha) {
  let envToAdd = { 'SERF_SHA1': sha };

  let opts = {
    cwd: rootDir,
    env: _.assign({}, envToAdd, process.env)
  };

  return spawnDetached(cmd, args, opts);
}
