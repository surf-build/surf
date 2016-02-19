import _ from 'lodash';
import { asyncMap } from './promise-array';
import { rimraf } from './promisify';
import { getAllWorkdirs } from './git-api';
import { getNwoFromRepoUrl } from './github-api';
import request from 'request-promise';

const d = require('debug')('surf:surf-clean');

export default async function main(argv, showHelp) {
  if (!argv.s || !argv.r) {
    showHelp();
    process.exit(-1);
  }
  
  // Do an initial fetch to get our initial state
  let refInfo = null;
  let surfUrl = `${argv.s}/info/${getNwoFromRepoUrl(argv.r)}`;

  try {
    refInfo = await request({
      uri: surfUrl,
      json: true
    });
  } catch (e) {
    console.log(`Failed to fetch from ${surfUrl}: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  }

  let safeShas = _.map(refInfo, (ref) => `-${ref.object.sha.substr(0,6)}-`);
  
  d(`safeShas: ${Array.from(safeShas).join()}`);
  let allDirs = await getAllWorkdirs(argv.r);
  let toDelete = _.filter(
    allDirs, 
    (x) => !_.find(safeShas, (sha) => x.indexOf(sha) > 0));
  
  if (argv['dry-run']) {
    _.each(toDelete, (x) => console.log(x));
  } else {
    await asyncMap(toDelete, (x) => {
      d(`Burninating path '${x}'`);
      return rimraf(x);
    });
  }
}
