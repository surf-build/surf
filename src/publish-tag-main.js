import path from 'path';
import mkdirp from 'mkdirp';

import { getNwoFromRepoUrl, fetchAllTags, fetchStatusesForCommit } from './github-api';
import { retryPromise } from './promise-array';

const d = require('debug')('surf:surf-publish');

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

export default async function main(argv, showHelp) {
  let repo = argv.repo || process.env.SURF_REPO;
  let tag = argv.tag;
  
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
  console.log(JSON.stringify(statuses));
}
