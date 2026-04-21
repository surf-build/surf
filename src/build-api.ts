import * as fs from "node:fs";
import * as path from "node:path";
import { concat } from "rxjs";
import { share } from "rxjs/operators";
import { findActualExecutable, spawn } from "spawn-rx";
import type BuildDiscoverBase from "./build-discover-base";
import type { BuildCommand, BuildCommandResult } from "./build-discover-base";
import {
  addFilesToGist,
  getGistTempdir,
  pushGistRepoToMaster,
} from "./git-api";
import { asyncReduce } from "./promise-array";

// tslint:disable-next-line:no-var-requires
const d = require("debug")("surf:build-api");

export function createBuildDiscovers(rootPath: string): BuildDiscoverBase[] {
  const discoverClasses = fs.readdirSync(
    path.join(__dirname, "build-discoverers"),
  );

  return discoverClasses
    .filter((x) => x.match(/\.[jt]s$/i) && !x.match(/\.d\.ts$/i))
    .map((file) => {
      const Klass = require(
        path.join(__dirname, "build-discoverers", file),
      ).default;

      d(`Found build discoverer: ${Klass.name}`);
      return new Klass(rootPath);
    });
}

export async function determineBuildCommands(rootPath: string, sha: string) {
  const discoverers = createBuildDiscovers(rootPath);
  let activeDiscoverers: { affinity: number; discoverer: BuildDiscoverBase }[] =
    [];

  const mainDiscoverer = await asyncReduce(
    discoverers,
    async (
      acc: { affinity: number; discoverer: BuildDiscoverBase | null },
      x,
    ) => {
      const affinity = (await x.getAffinityForRootDir()) || 0;
      if (affinity < 1) return acc;

      if (x.shouldAlwaysRun) {
        activeDiscoverers.push({ affinity, discoverer: x });
        return acc;
      }

      return acc.affinity < affinity ? { affinity, discoverer: x } : acc;
    },
    { affinity: -1, discoverer: null },
  );

  if (mainDiscoverer.discoverer) {
    activeDiscoverers.push({
      affinity: mainDiscoverer.affinity,
      discoverer: mainDiscoverer.discoverer!,
    });
  }

  activeDiscoverers = activeDiscoverers.sort((a, b) => a.affinity - b.affinity);

  if (activeDiscoverers.length < 1) {
    throw new Error(
      "We can't figure out how to build this repo automatically.",
    );
  }

  const ret: BuildCommandResult = {
    cmds: [],
    artifactDirs: [],
  };

  for (const { discoverer } of activeDiscoverers) {
    const thisCmd = await discoverer.getBuildCommand(sha);

    d(`Discoverer returned ${JSON.stringify(thisCmd)}`);
    const newCmds = thisCmd.cmds.map((x) => {
      return {
        ...findActualExecutable(x.cmd, x.args),
        cwd: x.cwd,
      };
    });
    ret.cmds.push(...newCmds);

    if (thisCmd.artifactDirs) {
      ret.artifactDirs!.push(...thisCmd.artifactDirs);
    }
  }

  ret.cmds.forEach((x) => {
    d(`Actual executable to run: ${x.cmd} ${x.args.join(" ")}`);
  });
  return ret;
}

export function runAllBuildCommands(
  cmds: BuildCommand[],
  rootDir: string,
  sha: string,
  tempDir: string,
) {
  const toConcat = cmds.map(({ cmd, args, cwd }) => {
    return runBuildCommand(cmd, args, cwd || rootDir, sha, tempDir);
  });

  return concat(...toConcat).pipe(share());
}

export function runBuildCommand(
  cmd: string,
  args: string[],
  rootDir: string,
  sha: string,
  tempDir: string,
) {
  const envToAdd = {
    SURF_SHA1: sha,
    SURF_ORIGINAL_TMPDIR: process.env.TMPDIR || process.env.TEMP || "/tmp",
    TMPDIR: tempDir,
    TEMP: tempDir,
    TMP: tempDir,
  };

  const opts = {
    cwd: rootDir,
    env: Object.assign({}, process.env, envToAdd),
  };

  d(`Running ${cmd} ${args.join(" ")}...`);
  return spawn(cmd, args, { ...opts, split: false });
}

export async function uploadBuildArtifacts(
  gistId: string,
  gistCloneUrl: string,
  artifactDirs: string[],
  buildLog: string,
  token: string,
) {
  const targetDir = getGistTempdir(gistId);

  // Add the build log even though it isn't an artifact
  await addFilesToGist(gistCloneUrl, targetDir, buildLog, token);

  for (const artifactDir of artifactDirs) {
    await addFilesToGist(gistCloneUrl, targetDir, artifactDir, token);
  }

  await pushGistRepoToMaster(targetDir, token);
  return targetDir;
}
