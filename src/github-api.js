import './babel-maybefill';

import mimeTypes from 'mime-types';
import fs from 'fs';
import url from 'url';
import _ from 'lodash';
import request from 'request-promise';
import requestOg from 'request';
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

const sshRemoteUrl = /^git@(.*):([^.]*)(\.git)?$/i;
const httpsRemoteUri = /https?:\/\//i;

export function getSanitizedRepoUrl(repoUrl) {
  if (repoUrl.match(httpsRemoteUri)) return repoUrl;
  let m = repoUrl.match(sshRemoteUrl);

  if (!m) {
    d(`URL ${repoUrl} seems totally bogus`);
    return repoUrl;
  }

  if (m[1] === 'github.com') {
    return `https://github.com/${m[2]}`;
  } else {
    let host = process.env.GITHUB_ENTERPRISE_URL || `https://${m[1]}`;
    return `${host}/${m[2]}`;
  }
}

export function getNwoFromRepoUrl(repoUrl) {
  // Fix up SSH repo origins
  let m = repoUrl.match(sshRemoteUrl);
  if (m) { return m[2]; }

  let u = url.parse(repoUrl);
  return u.path.slice(1).replace(/\.git$/, '');
}

export function getIdFromGistUrl(gistUrl) {
  let u = url.parse(gistUrl);
  let s = u.pathname.split('/');
  
  // NB: Anonymous Gists don't have usernames, just the token
  return s[2] || s[1];
}

export async function gitHub(uri, token=null, body=null, extraHeaders=null, targetFile=null) {
  let tok = token || process.env.GITHUB_TOKEN;

  d(`Fetching GitHub URL: ${uri}`);
  let opts = {
    uri: uri,
    headers: {
      'User-Agent': `${pkg.name}/${pkg.version}`,
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${tok}`
    },
    json: true,
    followAllRedirects: true
  };

  if (body) {
    opts.body = body;
    opts.method = 'POST';
  }

  if (extraHeaders) {
    Object.assign(opts.headers, extraHeaders);
  }
    
  if (_.isNumber(body) || body instanceof Buffer || body instanceof fs.ReadStream) {
    delete opts.json;
  }

  if (targetFile) {
    delete opts.json;

    await new Promise((res,rej) => {
      let str = requestOg(opts)
        .pipe(fs.createWriteStream(targetFile));

      str.on('finish', () => res());
      str.on('error', (e) => rej(e));
    });

    return { result: targetFile, headers: {}};
  }

  let ret = null;
  let result = null;
  try {
    ret = request(opts);
    result = await ret;
  } catch (e) {
    d(JSON.stringify(e.cause));
    d(JSON.stringify(e.message));
    throw e;
  }

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

  d(JSON.stringify(body));
  return gitHub(apiUrl(`repos/${nwo}/statuses/${sha}`), token, body);
}

export function createGist(description, files, publicGist=false, token=null) {
  let body = { files, description, "public": publicGist };
  return gitHub(apiUrl('gists', true), token || process.env.GIST_TOKEN, body);
}

export function fetchAllTags(nwo, token=null) {
  return githubPaginate(apiUrl(`repos/${nwo}/tags?per_page=100`), token, 60*1000);
}

export function fetchStatusesForCommit(nwo, sha, token=null) {
  return githubPaginate(apiUrl(`repos/${nwo}/commits/${sha}/statuses?per_page=100`), token, 60*1000);
}

export function createRelease(nwo, tag, token=null) {
  let body = { 
    tag_name: tag,
    target_committish: tag,
    name: `${nwo.split('/')[1]} @ ${tag}`,
    body: 'To be written',
    draft: true
  };
  
  return gitHub(apiUrl(`repos/${nwo}/releases`), token, body);
}

export function uploadFileToRelease(releaseInfo, targetFile, fileName, token=null) {
  let uploadUrl = releaseInfo.upload_url.replace(/{[^}]*}/g, '');
  uploadUrl = uploadUrl + `?name=${encodeURIComponent(fileName)}`;
  
  let contentType = {
    "Content-Type": mimeTypes.lookup[fileName] || 'application/octet-stream',
    "Content-Length": fs.statSync(targetFile).size
  };

  d(JSON.stringify(contentType));
  return gitHub(uploadUrl, token, fs.createReadStream(targetFile), contentType);
}

export function getReleaseByTag(nwo, tag, token=null) {
  return gitHub(apiUrl(`repos/${nwo}/releases/tags/${tag}`), token);
}

export function downloadReleaseAsset(nwo, assetId, targetFile, token=null) {
  let headers = { "Accept": "application/octet-stream" };
  return gitHub(apiUrl(`repos/${nwo}/releases/assets/${assetId}`), token, null, headers, targetFile);
}
