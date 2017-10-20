import * as fs from 'fs';
import * as path from 'path';
import {Observable} from 'rxjs';

import { asyncReduce } from './promise-array';
import { spawnDetached, findActualExecutable } from 'spawn-rx';
import { addFilesToGist, getGistTempdir, pushGistRepoToMaster } from './git-api';
import BuildDiscoverBase, { BuildCommandResult, BuildCommand } from './build-discover-base';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:build-api');

export function createBuildDiscovers(rootPath: string): BuildDiscoverBase[] {
  let discoverClasses = fs.readdirSync(path.join(__dirname, 'build-discoverers'));

  return discoverClasses.filter((x) => x.match(/\.[jt]s$/i) && !x.match(/\.d\.ts$/i)).map((file) => {
    const Klass = require(path.join(__dirname, 'build-discoverers', file)).default;

    d(`Found build discoverer: ${Klass.name}`);
    return new Klass(rootPath);
  });
}

export async function determineBuildCommands(rootPath: string, sha: string) {
  let discoverers = createBuildDiscovers(rootPath);
  let activeDiscoverers: { affinity: number, discoverer: BuildDiscoverBase }[] = [];

  let mainDiscoverer = await asyncReduce(discoverers, async (acc: { affinity: number, discoverer: BuildDiscoverBase | null}, x) => {
    let affinity = await x.getAffinityForRootDir() || 0;
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
    activeDiscoverers.push({ affinity: mainDiscoverer.affinity, discoverer: mainDiscoverer.discoverer!});
  }

  activeDiscoverers = activeDiscoverers.sort((a, b) => a.affinity - b.affinity);

  if (activeDiscoverers.length < 1) {
    throw new Error("We can't figure out how to build this repo automatically.");
  }

  let ret: BuildCommandResult = {
    cmds: [],
    artifactDirs: []
  };

  for (let {discoverer} of activeDiscoverers) {
    let thisCmd = await discoverer.getBuildCommand(sha);

    d(`Discoverer returned ${JSON.stringify(thisCmd)}`);
    let newCmds = thisCmd.cmds.map((x) => findActualExecutable(x.cmd, x.args));
    ret.cmds.push(...newCmds);

    if (thisCmd.artifactDirs) {
      ret.artifactDirs!.push(...thisCmd.artifactDirs);
    }
  }

  ret.cmds.forEach((x) => d(`Actual executable to run: ${x.cmd} ${x.args.join(' ')}`));
  return ret;
}

export function runAllBuildCommands(cmds: BuildCommand[], rootDir: string, sha: string, tempDir: string) {
  let toConcat = cmds.map(({cmd, args}) => {
    return runBuildCommand(cmd, args, rootDir, sha, tempDir);
  });

  return Observable.concat(...toConcat)
    .publish().refCount();
}

export function runBuildCommand(cmd: string, args: string[], rootDir: string, sha: string, tempDir: string) {
  let envToAdd = {
    'SURF_SHA1': sha,
    'SURF_ORIGINAL_TMPDIR': process.env.TMPDIR || process.env.TEMP || '/tmp',
    'TMPDIR': tempDir,
    'TEMP': tempDir,
    'TMP': tempDir
  };

  let opts = {
    cwd: rootDir,
    env: Object.assign({}, process.env, envToAdd)
  };

  d(`Running ${cmd} ${args.join(' ')}...`);
  return spawnDetached(cmd, args, opts);
}

export async function uploadBuildArtifacts(gistId: string, gistCloneUrl: string, artifactDirs: string[], buildLog: string, token: string) {
  let targetDir = getGistTempdir(gistId);

  // Add the build log even though it isn't an artifact
  await addFilesToGist(gistCloneUrl, targetDir, buildLog, token);

  for (let artifactDir of artifactDirs) {
    await addFilesToGist(gistCloneUrl, targetDir, artifactDir, token);
  }

  await pushGistRepoToMaster(targetDir, token);
  return targetDir;
}
