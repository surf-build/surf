import './babel-maybefill';

import url from 'url';
import _ from 'lodash';
import request from 'request-promise';
import parseLinkHeader from 'parse-link-header';
import pkg from '../package.json';
import {asyncMap} from './promise-array';
import createLRU from 'lru-cache';

const d = require('debug')('surf:github-api');

function apiUrl(path, gist=false) {
  let apiRoot = gist ?
    (process.env.GIST_ENTERPRISE_URL || process.env.GITHUB_ENTERPRISE_URL) :
    process.env.GITHUB_ENTERPRISE_URL;
    
  if (apiRoot) {
    return `${apiRoot}/api/v3/${path}`;
  } else {
    return `https://api.github.com/${path}`;
  }
}

export function getNwoFromRepoUrl(repoUrl) {
  // Fix up SSH repo origins
  if (repoUrl.match(/^git@.*:.*\.git$/i)) {
    return repoUrl.split(':')[1].replace(/\.git$/, '');
  }

  let u = url.parse(repoUrl);
  return u.path.slice(1);
}

export async function gitHub(uri, token=null, body=null) {
  let tok = token || process.env.GITHUB_TOKEN;

  d(`Fetching GitHub URL: ${uri}`);
  let opts = {
    uri: uri,
    headers: {
      'User-Agent': `${pkg.name}/${pkg.version}`,
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${tok}`
    },
    json: true
  };

  if (body) {
    opts.body = body;
    opts.method = 'POST';
  }

  let ret = request(opts);

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

export function filterBoringRefs(refs) {
  return _.filter(refs, (ref) => {
    if (ref.ref.match(/__gh/)) return false;
    if (ref.ref.match(/\/merge$/i)) return false;

    return true;
  });
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
  return githubPaginate(apiUrl(`repos/${nwo}/git/refs?per_page=100`), null, 60*1000);
}

export async function fetchAllRefsWithInfo(nwo) {
  let refs = filterBoringRefs(await fetchAllRefs(nwo));

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

export function postCommitStatus(nwo, sha, state, description, target_url, context, token=null) {
  let body = { state, target_url, description, context };
  if (!target_url) {
    delete body.target_url;
  }

  return gitHub(apiUrl(`repos/${nwo}/statuses/${sha}`), token, body);
}

export function createGist(description, files, publicGist=false, token=null) {
  let body = { files, description, "public": publicGist };

  return gitHub(apiUrl('gists', true), token || process.env.GIST_TOKEN, body);
}
