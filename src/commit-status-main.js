#!/usr/bin/env node

import _ from 'lodash';
import request from 'request-promise'; import chalk from 'chalk';

import {asyncMap} from './promise-array';
import {getOriginForRepo} from './git-api';
import {getNwoFromRepoUrl, getCombinedStatusesForCommit} from './github-api';
import createRefServer from './ref-server-api';

const d = require('debug')('surf:commit-status-main');

export default async function main(repo, server, jsonOnly, showHelp) {
  repo = repo || process.env.SURF_REPO;

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

  let killRefServer = null;
  if (!server) {
    let nwo = getNwoFromRepoUrl(repo);
    killRefServer = createRefServer([nwo]);
    server = `http://localhost:${process.env.SURF_PORT || 3000}`;
  }

  d(`Getting nwo for ${repo}`);
  let nwo = getNwoFromRepoUrl(repo);
  let surfUrl = `${server}/info/${nwo}`;

  const fetchRefs = async () => {
    return await request({
      uri: surfUrl,
      json: true
    });
  };

  let refList = await fetchRefs();
  let refToObject = refList.reduce((acc,x) => {
    acc[x.ref] = x.object;
    return acc;
  }, {});
  
  let statuses = await asyncMap(
    _.map(refList, (x) => x.ref),
    async (ref) => {
      let sha = refToObject[ref].sha;
      return (await getCombinedStatusesForCommit(nwo, sha)).result;
    });
    
  if (jsonOnly) {
    let statusArr = _.reduce(refList, (acc, x) => {
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
      _.each(status.statuses, (status) => {
        console.log(`  ${status.description} - ${status.target_url}`);
      });
    }
  }

  if (killRefServer) killRefServer.unsubscribe();
}
