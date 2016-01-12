import _ from 'lodash';
import AllBuildDiscoverers from './build-discover-drivers';
import findActualExecutable from './find-actual-executable';
import { asyncReduce, spawn } from './promise-array';

export function createBuildDiscovers(rootPath) {
  return _.map(Object.keys(AllBuildDiscoverers), (Klass) => {
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
  return findActualExecutable(cmd, args);
}

export function runBuildCommand(cmd, args, rootDir, sha) {
  let envToAdd = { 'SERF_SHA1': sha };

  let opts = {
    cwd: rootDir,
    env: _.assign({}, envToAdd, process.env)
  };

  return spawn(cmd, args, opts);
}
