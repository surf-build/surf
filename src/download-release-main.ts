import * as path from 'node:path'

import { downloadReleaseAsset, getNwoFromRepoUrl, getReleaseByTag } from './github-api'
import { asyncMap, retryPromise } from './promise-array'

const d = require('debug')('surf:surf-publish')

export default async function main(argv: any, showHelp: () => void) {
  const repo = argv.repo || process.env.SURF_REPO
  const tag = argv.tag
  const target = argv.target || path.resolve('.')

  if (argv.help) {
    showHelp()
    process.exit(0)
  }

  if (!tag || !repo) {
    d(`Tag or repo not set: ${tag}, ${repo}`)

    showHelp()
    process.exit(-1)
  }

  const nwo = getNwoFromRepoUrl(repo)
  const release = (await getReleaseByTag(nwo, tag)).result
  await asyncMap(release.assets, (asset: any) => {
    if (asset.state !== 'uploaded') return Promise.resolve(true)
    const file = path.join(target, asset.name)

    return retryPromise(() => downloadReleaseAsset(nwo, asset.id, file))
  })
}
