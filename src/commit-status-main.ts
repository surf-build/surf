#!/usr/bin/env node
import * as chalk from 'chalk';

import {asyncMap} from './promise-array';
import {getOriginForRepo} from './git-api';
import {fetchAllRefsWithInfo, getNwoFromRepoUrl, getCombinedStatusesForCommit} from './github-api';

const d = require('debug')('surf:commit-status-main');

export default async function main(theRepo: string, jsonOnly: boolean, help: boolean, showHelp: (() => void)) {
  if (help) {
    showHelp();
    process.exit(0);
  }

  let repo = theRepo || process.env.SURF_REPO;

  if (!repo) {
    try {
      repo = await getOriginForRepo('.');
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  d(`Getting nwo for ${repo}`);
  let nwo = getNwoFromRepoUrl(repo!);

  let refList = await fetchAllRefsWithInfo(nwo);
  let refToObject = refList.reduce((acc,x) => {
    acc[x.ref] = x.object;
    return acc;
  }, {});
  
  let statuses = await asyncMap(
    refList.map((x) => x.ref),
    async (ref) => {
      let sha = refToObject[ref].sha;
      return (await getCombinedStatusesForCommit(nwo, sha)).result;
    });
    
  if (jsonOnly) {
    let statusArr = refList.reduce((acc, x) => {
      acc[x.ref] = statuses[x.ref];
      delete acc[x.ref].repository;
      return acc;
    }, {});

    console.log(JSON.stringify(statusArr));
  } else {
    const statusToIcon = {
      'success': chalk.green('✓'),
      'failure': chalk.red('✘'),
      'error': chalk.red('✘'),
      'pending': chalk.yellow('‽')
    };

    console.log(`Commit Status Information for ${repo}\n`);
    for (let ref of refList) {
      let status = statuses[ref.ref];

      let friendlyName = ref.object.pr ?
        `#${ref.object.pr.number} (${ref.object.pr.title})` :
        `${ref.ref.replace('refs/heads/', '')}`;

      //console.log(JSON.stringify(status));
      if (!status || status.total_count === 0) {
        console.log(`${statusToIcon['pending']}: ${friendlyName} - no commit status for this branch / PR`);
        continue;
      }

      if (status.total_count === 1) {
        d(JSON.stringify(status));
        console.log(`${statusToIcon[status.state]}: ${friendlyName} - ${status.statuses[0].description || '(No description)'} - ${status.statuses[0].target_url || '(No CI URL given)'}`);
        continue;
      }

      console.log(`${statusToIcon[status.state]}: ${friendlyName}`);
      status.statuses.each((status: any) => {
        console.log(`  ${status.description} - ${status.target_url}`);
      });
    }
  }
}
