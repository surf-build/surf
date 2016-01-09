import './babel-maybefill';

import _ from 'lodash';
import request from 'request-promise';
import parseLinkHeader from 'parse-link-header';
import pkg from '../package.json';
import {asyncMap} from './promise-array';
import createLRU from 'lru-cache';

const d = require('debug')('serf:github-api');

export async function gitHub(uri, token=null) {
  let tok = token || process.env.GITHUB_TOKEN;
  
  d(`Fetching GitHub URL: ${uri}`);
  let ret = request({
    uri: uri,
    headers: {
      'User-Agent': `${pkg.name}/${pkg.version}`,
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${tok}`
    },
    json: true
  });
  
  let result = await ret;
  return { result, headers: ret.response.headers };
}

const githubCache = createLRU({
  max: 1000
});

export async function cachedGitHub(uri, token=null, maxAge=null) {
  let ret = githubCache.get(uri);
  if (ret) return ret;
  
  ret = await gitHub(uri, token);
  githubCache.set(uri, ret, maxAge);
  return ret;
}

export async function githubPaginate(uri, token=null, maxAge=null) {
  let next = uri;
  let ret = [];
  
  do {
    let {headers, result} = await cachedGitHub(next, token, maxAge);
    ret = ret.concat(result);
    
    if (!headers['link']) break;
    
    let links = parseLinkHeader(headers['link']);
    next = 'next' in links ? links.next.url : null;
  } while (next);
  
  return ret;
}

export function fetchAllRefs(nwo) {
  return githubPaginate(`https://api.github.com/repos/${nwo}/git/refs?per_page=100`, null, 60*1000);
}

export async function fetchAllRefsWithInfo(nwo) {
  let refs = await fetchAllRefs(nwo);
  
  let commitInfo = await asyncMap(
    _.map(refs, (ref) => ref.object.url), 
    async (x) => {
      return (await cachedGitHub(x)).result;
    });
    
  _.each(refs, (ref) => {
    ref.object.commit = commitInfo[ref.object.url];
  });
    
  return refs;
}
