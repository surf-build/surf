import './babel-maybefill';

import url from 'url';
import _ from 'lodash';
import request from 'request-promise';
import parseLinkHeader from 'parse-link-header';
import pkg from '../package.json';
import {asyncMap} from './promise-array';
import createLRU from 'lru-cache';

const d = require('debug')('serf:github-api');

export function getNwoFromRepoUrl(repoUrl) {
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
    opts.method = 'post';
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
    if (ref.name.match(/__gh/)) return false;
    if (ref.name.match(/\/merge$/i)) return false;

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
  return githubPaginate(`https://api.github.com/repos/${nwo}/git/refs?per_page=100`, null, 60*1000);
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
  return gitHub(`https://api.github.com/repos/${nwo}/statuses/${sha}`, token, body);
}
