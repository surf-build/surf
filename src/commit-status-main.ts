#!/usr/bin/env node
import chalk from 'chalk'
import { getOriginForRepo } from './git-api'
import { fetchAllRefsWithInfo, getCombinedStatusesForCommit, getNwoFromRepoUrl } from './github-api'
import { asyncMap } from './promise-array'

const d = require('debug')('surf:commit-status-main')

export default async function main(theRepo: string, jsonOnly: boolean, help: boolean, showHelp: () => void) {
  if (help) {
    showHelp()
    process.exit(0)
  }

  let repo = theRepo || process.env.SURF_REPO

  if (!repo) {
    try {
      repo = await getOriginForRepo('.')
    } catch (e) {
      console.error('Repository not specified and current directory is not a Git repo')
      d(e.stack)

      showHelp()
      process.exit(-1)
    }
  }

  d(`Getting nwo for ${repo}`)
  const nwo = getNwoFromRepoUrl(repo!)

  const refList = await fetchAllRefsWithInfo(nwo)
  const refToObject = refList.reduce((acc, x) => {
    acc[x.ref] = x.object
    return acc
  }, {})

  const statuses = await asyncMap(
    refList.map((x) => x.ref),
    async (ref) => {
      const sha = refToObject[ref].sha
      return (await getCombinedStatusesForCommit(nwo, sha)).result
    }
  )

  if (jsonOnly) {
    const statusArr = refList.reduce((acc, x) => {
      acc[x.ref] = statuses.get(x.ref)
      delete acc[x.ref].repository
      return acc
    }, {})

    console.log(JSON.stringify(statusArr))
  } else {
    const statusToIcon = {
      success: chalk.green('✓'),
      failure: chalk.red('✘'),
      error: chalk.red('✘'),
      pending: chalk.yellow('‽'),
    }

    console.log(`Commit Status Information for ${repo}\n`)
    for (const ref of refList) {
      const status = statuses.get(ref.ref)

      const friendlyName = ref.object.pr
        ? `#${ref.object.pr.number} (${ref.object.pr.title})`
        : `${ref.ref.replace('refs/heads/', '')}`

      //console.log(JSON.stringify(status));
      if (!status || status.total_count === 0) {
        console.log(`${statusToIcon.pending}: ${friendlyName} - no commit status for this branch / PR`)
        continue
      }

      if (status.total_count === 1) {
        d(JSON.stringify(status))
        console.log(
          `${statusToIcon[status.state]}: ${friendlyName} - ${status.statuses[0].description || '(No description)'} - ${status.statuses[0].target_url || '(No CI URL given)'}`
        )
        continue
      }

      console.log(`${statusToIcon[status.state]}: ${friendlyName}`)
      status.statuses.forEach((status: any) => {
        console.log(`  ${status.description} - ${status.target_url}`)
      })
    }
  }
}
