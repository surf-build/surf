import { createReadStream, createWriteStream, ReadStream, statSync } from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as mimeTypes from 'mime-types'
import * as parseLinkHeader from 'parse-link-header'
import { asyncMap } from './promise-array'

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

type GitHubHeaders = Record<string, string>

const pkg = require(path.join(__dirname, '..', 'package.json'))
const d = require('debug')('surf:github-api')
const githubCache = new Map<string, CacheEntry<GitHubResponse>>()
const refCache = new Map<string, CacheEntry<any>>()
const sshRemoteUrl = /^git@(.*):([^.]*)(\.git)?$/i
const httpsRemoteUri = /https?:\/\//i

export interface GitHubResponse {
  headers: GitHubHeaders
  result: any
}

export interface GistFiles {
  description: string
  public: boolean
  files: Array<any>
}

export function getSanitizedRepoUrl(repoUrl: string) {
  if (repoUrl.match(httpsRemoteUri)) return repoUrl
  const match = repoUrl.match(sshRemoteUrl)

  if (!match) {
    d(`URL ${repoUrl} seems totally bogus`)
    return repoUrl
  }

  if (match[1] === 'github.com') {
    return `https://github.com/${match[2]}`
  }

  const host = process.env.GITHUB_ENTERPRISE_URL || `https://${match[1]}`
  return `${host}/${match[2]}`
}

export function getNwoFromRepoUrl(repoUrl: string) {
  const match = repoUrl.match(sshRemoteUrl)
  if (match) {
    return match[2]
  }

  const parsedUrl = new URL(repoUrl)
  return parsedUrl.pathname.slice(1).replace(/\.git$/, '')
}

export function getIdFromGistUrl(gistUrl: string) {
  const parsedUrl = new URL(gistUrl)
  const parts = parsedUrl.pathname.split('/')

  return parts[2] || parts[1]
}

export async function gitHub(
  uri: string,
  token?: string,
  body: object | number | Buffer | ReadStream | null = null,
  extraHeaders?: Record<string, string | number>,
  targetFile?: string
): Promise<GitHubResponse> {
  const authToken = token || process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': `${pkg.name}/${pkg.version}`,
  }

  if (authToken) {
    headers.Authorization = `token ${authToken}`
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = String(value)
    }
  }

  let requestBody: BodyInit | undefined
  const requestInit: RequestInit & { duplex?: 'half' } = {
    headers,
    method: body ? 'POST' : 'GET',
    redirect: 'follow',
  }

  if (body !== null) {
    if (body instanceof ReadStream) {
      requestBody = body as unknown as BodyInit
      requestInit.duplex = 'half'
    } else if (body instanceof Buffer) {
      requestBody = body as unknown as BodyInit
    } else if (typeof body === 'number') {
      requestBody = body.toString()
    } else {
      headers['Content-Type'] ??= 'application/json'
      requestBody = JSON.stringify(body)
    }

    requestInit.body = requestBody
  }

  d(`Fetching GitHub URL: ${uri}`)
  const response = await fetch(uri, requestInit)
  const responseHeaders = Object.fromEntries(response.headers.entries())

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`GitHub request failed (${response.status}): ${errorBody}`)
  }

  if (targetFile) {
    if (!response.body) {
      throw new Error(`GitHub returned an empty response body for ${uri}`)
    }

    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(targetFile))

    return { headers: responseHeaders, result: targetFile }
  }

  const contentType = response.headers.get('content-type') || ''
  const result = contentType.includes('json') ? await response.json() : await response.text()
  return { headers: responseHeaders, result }
}

export async function cachedGitHub(uri: string, token?: string, maxAge = 0) {
  const cached = getCachedValue(githubCache, uri)
  if (cached) {
    return cached
  }

  const result = await gitHub(uri, token)
  setCachedValue(githubCache, uri, result, maxAge)
  return result
}

export async function githubPaginate(uri: string, token?: string, maxAge?: number) {
  let next: string | null = uri
  let results: any[] = []

  while (next) {
    const { headers, result } = await cachedGitHub(next, token, maxAge)
    results = results.concat(result)

    const linkHeader = headers.link
    if (!linkHeader) {
      break
    }

    const links = parseLinkHeader(linkHeader)
    next = links?.next?.url || null
  }

  return results
}

export function fetchAllOpenPRs(nwo: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/pulls?state=open`), undefined, 60 * 1000)
}

export async function fetchSingleRef(nwo: string, ref: string, shaHint?: string) {
  const cached = shaHint ? getCachedValue(refCache, shaHint) : null
  if (cached) {
    return cached
  }

  const githubResponse = await cachedGitHub(apiUrl(`repos/${nwo}/git/refs/heads/${ref}`), undefined, 30 * 1000)
  setCachedValue(refCache, githubResponse.result.object.sha, githubResponse.result, 30 * 1000)
  return githubResponse.result
}

export async function fetchRepoInfo(nwo: string) {
  const response = await cachedGitHub(apiUrl(`repos/${nwo}`), undefined, 5 * 60 * 1000)
  return response.result
}

export async function fetchAllRefsWithInfo(nwo: string) {
  const openPRs = await fetchAllOpenPRs(nwo)
  const refList = openPRs.map((pullRequest) => pullRequest.head.ref)
  const refToPR = openPRs.reduce((accumulator: Record<string, any>, pullRequest) => {
    accumulator[pullRequest.head.ref] = pullRequest
    return accumulator
  }, {})

  const refMap = await asyncMap(refList, async (ref) => {
    const repoName = refToPR[ref].head.repo.full_name
    const shaHint = refToPR[ref].head.sha

    try {
      return await fetchSingleRef(repoName, ref, shaHint)
    } catch (error) {
      d(`Tried to fetch ref ${repoName}:${ref} but it failed: ${error.message}`)
      return null
    }
  })

  const refs = Array.from(refMap.values()).filter((ref) => ref !== null)
  const repoInfo = await fetchRepoInfo(nwo)
  refs.push(await fetchSingleRef(nwo, repoInfo.default_branch))

  const commitInfo = await asyncMap(
    refs.map((ref) => ref.object.url),
    async (commitUrl) => {
      try {
        return (await cachedGitHub(commitUrl)).result
      } catch (error) {
        d(`Tried to fetch commit info for ${commitUrl} but failed: ${error.message}`)
        return null
      }
    }
  )

  refs.forEach((ref) => {
    ref.object.commit = commitInfo.get(ref.object.url)
    ref.object.pr = refToPR[ref.ref.replace(/^refs\/heads\//, '')]
  })

  return refs.filter((ref) => ref.object.commit)
}

export function postCommitStatus(
  nwo: string,
  sha: string,
  state: string,
  description: string,
  target_url: string | null,
  context: string,
  token?: string
) {
  const body: { state: string; description: string; context: string; target_url?: string } = {
    context,
    description,
    state,
  }

  if (target_url) {
    body.target_url = target_url
  }

  d(JSON.stringify(body))
  return gitHub(apiUrl(`repos/${nwo}/statuses/${sha}`), token, body)
}

export function createGist(description: string, files: Record<string, any>, publicGist?: boolean, token?: string) {
  return gitHub(apiUrl('gists', true), token || process.env.GIST_TOKEN, {
    description,
    files,
    public: publicGist,
  })
}

export function fetchAllTags(nwo: string, token?: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/tags?per_page=100`), token, 60 * 1000)
}

export function fetchStatusesForCommit(nwo: string, sha: string, token?: string) {
  return githubPaginate(apiUrl(`repos/${nwo}/commits/${sha}/statuses?per_page=100`), token, 60 * 1000)
}

export function getCombinedStatusesForCommit(nwo: string, sha: string, token?: string) {
  return gitHub(apiUrl(`repos/${nwo}/commits/${sha}/status`), token)
}

export function createRelease(nwo: string, tag: string, token?: string) {
  return gitHub(apiUrl(`repos/${nwo}/releases`), token, {
    body: 'To be written',
    draft: true,
    name: `${nwo.split('/')[1]} @ ${tag}`,
    tag_name: tag,
    target_committish: tag,
  })
}

export function uploadFileToRelease(targetUrl: string, targetFile: string, fileName: string, token?: string) {
  let uploadUrl = targetUrl.replace(/{[^}]*}/g, '')
  uploadUrl = `${uploadUrl}?name=${encodeURIComponent(fileName)}`

  const contentType = {
    'Content-Length': statSync(targetFile).size,
    'Content-Type': mimeTypes.lookup(fileName) || 'application/octet-stream',
  }

  d(JSON.stringify(contentType))
  return gitHub(uploadUrl, token, createReadStream(targetFile), contentType)
}

export function getReleaseByTag(nwo: string, tag: string, token?: string) {
  return gitHub(apiUrl(`repos/${nwo}/releases/tags/${tag}`), token)
}

export function downloadReleaseAsset(nwo: string, assetId: string, targetFile: string, token?: string) {
  return gitHub(
    apiUrl(`repos/${nwo}/releases/assets/${assetId}`),
    token,
    null,
    { Accept: 'application/octet-stream' },
    targetFile
  )
}

export async function findPRForCommit(nwo: string, sha: string, token?: string) {
  const result = (await gitHub(apiUrl(`search/issues?q=${sha}`), token)).result
  const item = result.items.find((entry: { pull_request?: { url: string } }) => {
    return Boolean(entry.pull_request?.url.includes(`/${nwo}/`))
  })

  if (!item?.pull_request) {
    return null
  }

  return (await gitHub(item.pull_request.url, token)).result
}

function apiUrl(pathname: string, gist = false) {
  const apiRoot = gist
    ? process.env.GIST_ENTERPRISE_URL || process.env.GITHUB_ENTERPRISE_URL
    : process.env.GITHUB_ENTERPRISE_URL

  if (apiRoot) {
    return `${apiRoot}/api/v3/${pathname}`
  }

  return `https://api.github.com/${pathname}`
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }

  if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, maxAge = 0) {
  const expiresAt = maxAge > 0 ? Date.now() + maxAge : 0
  cache.set(key, { expiresAt, value })
}
