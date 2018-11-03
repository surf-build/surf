import * as fs from 'fs';
import * as path from 'path';

// tslint:disable-next-line:no-var-requires
const flatten = require('lodash.flatten');

import { getSanitizedRepoUrl, getNwoFromRepoUrl, fetchAllTags, fetchStatusesForCommit,
  getIdFromGistUrl, createRelease, uploadFileToRelease } from './github-api';
import { cloneRepo, getOriginForRepo, getGistTempdir } from './git-api';
import { retryPromise } from './promise-array';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:surf-publish');

async function cloneSurfBuildGist(url: string) {
  let targetDir = getGistTempdir(getIdFromGistUrl(url));
  let token = process.env['GIST_TOKEN'] || process.env['GITHUB_TOKEN'];

  d(`${url} => ${targetDir}`);
  await cloneRepo(url, targetDir, token, false);
  return targetDir;
}

export default async function main(argv: any, showHelp: (() => void)) {
  let repo = argv.repo || process.env.SURF_REPO;
  let tag = argv.tag;

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
      argv.repo = repo;
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo');
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (!tag || !repo) {
    d(`Tag or repo not set: ${tag}, ${repo}`);

    showHelp();
    process.exit(-1);
  }

  // 1. Look up tag
  // 2. Run down CI statuses for tag SHA1
  // 3. Convert URLs to something clonable
  // 4. Clone them all
  // 5. Find the files
  // 6. Upload them all
  let nwo = getNwoFromRepoUrl(repo);
  let ourTag = (await fetchAllTags(nwo)).find((x) => x.name === tag);

  if (!ourTag) {
    throw new Error(`Couldn't find a matching tag on GitHub for ${tag}`);
  }

  let statuses = await fetchStatusesForCommit(nwo, ourTag.commit.sha);
  statuses = statuses.filter((x) => {
    return x.state === 'success' && x.target_url && x.target_url.match(/^https:\/\/gist\./i);
  });

  d(`About to download URLs: ${JSON.stringify(statuses, null, 2)}`);
  let targetDirMap = {};
  for (let status of statuses) {
    let targetDir = await cloneSurfBuildGist(status.target_url);
    targetDirMap[targetDir] = status.context;
  }

  let fileList: string[] = flatten(Object.keys(targetDirMap)
    .map((d) => fs.readdirSync(d)
      .filter((f) => f !== 'build-output.txt' && fs.statSync(path.join(d,f)).isFile())
      .map((f) => path.join(d,f))));

  let dupeFileList = fileList.reduce((acc, x) => {
    let basename = path.basename(x);

    acc[basename] = acc[basename] || 0;
    acc[basename]++;
    return acc;
  }, {});

  let releaseInfo = (await createRelease(nwo, ourTag.name)).result;
  d(JSON.stringify(dupeFileList));
  for (let file of fileList) {
    let name = path.basename(file);

    if (dupeFileList[name] > 1) {
      let relName = targetDirMap[path.dirname(file)];
      name = name.replace(/^([^\.]+)\./, `$1-${relName}.`);
      d(`Detected dupe, renaming to ${name}`);
    }

    d(`Uploading ${file} as ${name}`);
    await retryPromise(() => uploadFileToRelease(releaseInfo.upload_url, file, name), 3);
  }
}
