import * as fs from 'node:fs'
import * as path from 'node:path'
import { cloneRepo, getGistTempdir, getOriginForRepo } from './git-api'
import {
  createRelease,
  fetchAllTags,
  fetchStatusesForCommit,
  getIdFromGistUrl,
  getNwoFromRepoUrl,
  getSanitizedRepoUrl,
  uploadFileToRelease,
} from './github-api'
import { retryPromise } from './promise-array'

// tslint:disable-next-line:no-var-requires
const d = require('debug')('surf:surf-publish')

async function cloneSurfBuildGist(url: string) {
  const targetDir = getGistTempdir(getIdFromGistUrl(url))
  const token = process.env.GIST_TOKEN || process.env.GITHUB_TOKEN

  d(`${url} => ${targetDir}`)
  await cloneRepo(url, targetDir, token, false)
  return targetDir
}

export default async function main(argv: any, showHelp: () => void) {
  let repo = argv.repo || process.env.SURF_REPO
  const tag = argv.tag

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'))
      argv.repo = repo
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo')
      d(e.stack)

      showHelp()
      process.exit(-1)
    }
  }

  if (argv.help) {
    showHelp()
    process.exit(0)
  }

  if (!tag || !repo) {
    d(`Tag or repo not set: ${tag}, ${repo}`)

    showHelp()
    process.exit(-1)
  }

  // 1. Look up tag
  // 2. Run down CI statuses for tag SHA1
  // 3. Convert URLs to something clonable
  // 4. Clone them all
  // 5. Find the files
  // 6. Upload them all
  const nwo = getNwoFromRepoUrl(repo)
  const ourTag = (await fetchAllTags(nwo)).find((x) => x.name === tag)

  if (!ourTag) {
    throw new Error(`Couldn't find a matching tag on GitHub for ${tag}`)
  }

  let statuses = await fetchStatusesForCommit(nwo, ourTag.commit.sha)
  statuses = statuses.filter((x) => {
    return x.state === 'success' && x.target_url && x.target_url.match(/^https:\/\/gist\./i)
  })

  d(`About to download URLs: ${JSON.stringify(statuses, null, 2)}`)
  const targetDirMap = {}
  for (const status of statuses) {
    const targetDir = await cloneSurfBuildGist(status.target_url)
    targetDirMap[targetDir] = status.context
  }

  const fileList: string[] = Object.keys(targetDirMap).flatMap((d) =>
    fs
      .readdirSync(d)
      .filter((f) => f !== 'build-output.txt' && fs.statSync(path.join(d, f)).isFile())
      .map((f) => path.join(d, f))
  )

  const dupeFileList = fileList.reduce((acc, x) => {
    const basename = path.basename(x)

    acc[basename] = acc[basename] || 0
    acc[basename]++
    return acc
  }, {})

  const releaseInfo = (await createRelease(nwo, ourTag.name)).result
  d(JSON.stringify(dupeFileList))
  for (const file of fileList) {
    let name = path.basename(file)

    if (dupeFileList[name] > 1) {
      const relName = targetDirMap[path.dirname(file)]
      name = name.replace(/^([^.]+)\./, `$1-${relName}.`)
      d(`Detected dupe, renaming to ${name}`)
    }

    d(`Uploading ${file} as ${name}`)
    await retryPromise(() => uploadFileToRelease(releaseInfo.upload_url, file, name), 3)
  }
}
