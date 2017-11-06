import * as mimeTypes from 'mime-types';
import * as path from 'path';
import * as url from 'url';
import * as request from 'request-promise';
import * as requestOg from 'request';
import * as parseLinkHeader from 'parse-link-header';
import {asyncMap} from './promise-array';
import * as createLRU from 'lru-cache';
import { ReadStream } from 'fs';

// tslint:disable-next-line:no-var-requires
const isNumber = require('lodash.isnumber');

// tslint:disable-next-line:no-var-requires
const fs = require('fs');

// tslint:disable-next-line:no-var-requires
const pkg = require(path.join(__dirname, '..', 'package.json'));

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:github-api');

function apiUrl(path: string, gist = false) {
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

export function getSanitizedRepoUrl(repoUrl: string) {
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

export function getNwoFromRepoUrl(repoUrl: string) {
  // Fix up SSH repo origins
  let m = repoUrl.match(sshRemoteUrl);
  if (m) { return m[2]; }

  let u = url.parse(repoUrl);
  return u.path!.slice(1).replace(/\.git$/, '');
}

export function getIdFromGistUrl(gistUrl: string) {
  let u = url.parse(gistUrl);
  let s = u.pathname!.split('/');

  // NB: Anonymous Gists don't have usernames, just the token
  return s[2] || s[1];
}

export interface GitHubResponse {
  headers: requestOg.Headers;
  result: any;
}

export async function gitHub(
    uri: string,
    token?: string,
    body: Object | number | Buffer | ReadStream | null = null,
    extraHeaders?: requestOg.Headers,
    targetFile?: string): Promise<GitHubResponse> {
  let tok = token || process.env.GITHUB_TOKEN;

  d(`Fetching GitHub URL: ${uri}`);
  let opts: requestOg.Options = {
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

  if (isNumber(body) || body instanceof Buffer || body instanceof fs.ReadStream) {
    delete opts.json;
  }

  if (targetFile) {
    delete opts.json;

    await new Promise((res,rej) => {
      let str = requestOg(opts)
        .pipe(fs.createWriteStream(targetFile));

      str.on('finish', () => res());
      str.on('error', (e: Error) => rej(e));
    });

    return { result: targetFile, headers: {}};
  }

  let ret: any = null;
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

const githubCache: createLRU.Cache<string, GitHubResponse> = createLRU({
  max: 1000
});

export async function cachedGitHub(uri: string, token?: string, maxAge?: number) {
  let ret = githubCache.get(uri);
  if (ret) return ret;

  ret = await gitHub(uri, token);
  githubCache.set(uri, ret, maxAge);

  return ret;
}

export async function githubPaginate(uri: string, token?: string, maxAge?: number) {
  let next = uri;
  let ret: any[] = [];

  do {
    let {headers, result} = await cachedGitHub(next, token, maxAge);
    ret = ret.concat(result);

    if (!headers['link']) break;

    let links = parseLinkHeader(headers['link']);
    next = 'next' in links ? links.next.url : null;
  } while (next);

  return ret;
}

export function fetchAllOpenPRs(nwo: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/pulls?state=open`), undefined, 60 * 1000);
}

const refCache = createLRU({
  max: 1000
});

export async function fetchSingleRef(nwo: string, ref: string, shaHint?: string) {
  let ret = shaHint ? refCache.get(shaHint) : null;
  if (ret) {
    return ret;
  }

  let gh = await cachedGitHub(apiUrl(`repos/${nwo}/git/refs/heads/${ref}`), undefined, 30 * 1000);
  refCache.set(gh.result.object.sha, gh.result);
  return gh.result;
}

export async function fetchRepoInfo(nwo: string) {
  let ret = await cachedGitHub(apiUrl(`repos/${nwo}`), undefined, 5 * 60 * 1000);
  return ret.result;
}

export async function fetchAllRefsWithInfo(nwo: string) {
  let openPRs = (await fetchAllOpenPRs(nwo));
  let refList: string[] = openPRs.map((x) => x.head.ref);

  let refToPR = openPRs.reduce((acc, x) => {
    acc[x.head.ref] = x;
    return acc;
  }, {});

  let theMap = await asyncMap(
    refList,
    async (ref) => {
      let repoName = refToPR[ref].head.repo.full_name;
      let shaHint = refToPR[ref].head.sha;

      try {
        let ret = await fetchSingleRef(repoName, ref, shaHint);
        return ret;
      } catch (e) {
        d(`Tried to fetch ref ${repoName}:${ref} but it failed: ${e.message}`);
        return null;
      }
    });

  let refs = Array.from(theMap.values());

  // Monitor the default branch for the repo (usually 'master')
  let repoInfo = await fetchRepoInfo(nwo);
  let defaultBranch = repoInfo.default_branch;
  let result = await fetchSingleRef(nwo, defaultBranch);
  refs.push(result);

  // Filter failures from when we get the ref
  refs = refs.filter((x) => x !== null);

  let commitInfo = await asyncMap(refs.map((ref) => ref.object.url),
    async (x) => {
      try {
        return (await cachedGitHub(x)).result;
      } catch (e) {
        d(`Tried to fetch commit info for ${x} but failed: ${e.message}`);
        return null;
      }
    });

  refs.forEach((ref) => {
    ref.object.commit = commitInfo[ref.object.url];
    ref.object.pr = refToPR[ref.ref.replace(/^refs\/heads\//, '')];
  });

  // Filter failures from the commitInfo asyncMap above
  refs = refs.filter((r) => r.object.commit);

  return refs;
}

export function postCommitStatus(
    nwo: string,
    sha: string,
    state: string,
    description: string,
    target_url: string | null,
    context: string,
    token?: string) {
  let body = { state, target_url, description, context };
  if (!target_url) { delete body.target_url; }

  d(JSON.stringify(body));
  return gitHub(apiUrl(`repos/${nwo}/statuses/${sha}`), token, body);
}

export interface GistFiles {
  description: string;
  public: boolean;
  files: Array<any>;
}

export function createGist(description: string, files: Object, publicGist?: boolean, token?: string) {
  let body = { files, description, 'public': publicGist };
  return gitHub(apiUrl('gists', true), token || process.env.GIST_TOKEN, body);
}

export function fetchAllTags(nwo: string, token?: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/tags?per_page=100`), token, 60 * 1000);
}

export function fetchStatusesForCommit(nwo: string, sha: string, token?: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/commits/${sha}/statuses?per_page=100`), token, 60 * 1000);
}

export function getCombinedStatusesForCommit(nwo: string, sha: string, token?: string) {
  return gitHub(apiUrl(`repos/${nwo}/commits/${sha}/status`), token);
}

export function createRelease(nwo: string, tag: string, token?: string) {
  let body = {
    tag_name: tag,
    target_committish: tag,
    name: `${nwo.split('/')[1]} @ ${tag}`,
    body: 'To be written',
    draft: true
  };

  return gitHub(apiUrl(`repos/${nwo}/releases`), token, body);
}

export function uploadFileToRelease(targetUrl: string, targetFile: string, fileName: string, token?: string) {
  let uploadUrl = targetUrl.replace(/{[^}]*}/g, '');
  uploadUrl = uploadUrl + `?name=${encodeURIComponent(fileName)}`;

  let contentType: any = {
    'Content-Type': mimeTypes.lookup[fileName] || 'application/octet-stream',
    'Content-Length': fs.statSync(targetFile).size
  };

  d(JSON.stringify(contentType));
  return gitHub(uploadUrl, token, fs.createReadStream(targetFile), contentType);
}

export function getReleaseByTag(nwo: string, tag: string, token?: string) {
  return gitHub(apiUrl(`repos/${nwo}/releases/tags/${tag}`), token);
}

export function downloadReleaseAsset(nwo: string, assetId: string, targetFile: string, token?: string) {
  let headers = { 'Accept': 'application/octet-stream' };
  return gitHub(apiUrl(`repos/${nwo}/releases/assets/${assetId}`), token, null, headers, targetFile);
}

export async function findPRForCommit(nwo: string, sha: string, token?: string) {
  // NB: Thanks pea53 for this but also this is bananas weird lol
  let result = (await gitHub(apiUrl(`search/issues?q=${sha}`), token)).result;

  let item = result.items.find((x: { pull_request?: { url: string } }) => {
    if (!x.pull_request) return false;
    if (x.pull_request.url.indexOf(`/${nwo}/`) < 0) return false;

    return true;
  });

  if (!item || !item.pull_request) return null;
  return (await gitHub(item.pull_request.url)).result;
}
