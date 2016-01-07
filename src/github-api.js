import './babel-maybefill';
import rx from 'rx';
import request from 'request-promise';
import parseLinkHeader from 'parse-link-header';
import pkg from '../package.json'

const d = require('debug')('serf:github-api');

export function github(uri, token=null) {
  let tok = token || process.env.GITHUB_TOKEN;
  
  d(`Fetching GitHub URL: ${uri}`);
  return request({
    uri: uri,
    headers: {
      'User-Agent': `${pkg.name}/${pkg.version}`,
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${tok}`
    },
    json: true
  });
}

export async function githubPaginate(uri, token=null) {
  let next = uri;
  let ret = [];
  
  do {
    let resp = github(next);
    let result = await resp;
    ret = ret.concat(result);
    
    d(JSON.stringify(resp.response.headers));
    if (!resp.response.headers['link']) break;
    
    let links = parseLinkHeader(resp.response.headers['link']);
    next = 'next' in links ? links.next.url : null;
  } while (next);
  
  return ret;
}

export function fetchAllRefs(nwo) {
  return githubPaginate(`https://api.github.com/repos/${nwo}/git/refs`);
}
