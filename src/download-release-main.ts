import * as path from 'path';

import { getNwoFromRepoUrl, getReleaseByTag, downloadReleaseAsset } from './github-api';
import { retryPromise, asyncMap } from './promise-array';

const d = require('debug')('surf:surf-publish');

export default async function main(argv: any, showHelp: (() => void)) {
  let repo = argv.repo || process.env.SURF_REPO;
  let tag = argv.tag;
  let target = argv.target || path.resolve('.');

  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (!tag || !repo) {
    d(`Tag or repo not set: ${tag}, ${repo}`);

    showHelp();
    process.exit(-1);
  }

  let nwo = getNwoFromRepoUrl(repo);
  let release = (await getReleaseByTag(nwo, tag)).result;
  await asyncMap(release.assets, (asset: any) => {
    if (asset.state !== 'uploaded') return Promise.resolve(true);
    let file = path.join(target, asset.name);

    return retryPromise(() => downloadReleaseAsset(nwo, asset.id, file));
  });
}
