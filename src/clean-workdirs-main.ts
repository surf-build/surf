import { asyncMap } from './promise-array';
import { rimraf } from './recursive-fs';
import { getAllWorkdirs, getOriginForRepo } from './git-api';
import { fetchAllRefsWithInfo, getNwoFromRepoUrl, getSanitizedRepoUrl } from './github-api';

const d = require('debug')('surf:surf-clean');

export default async function main(argv: any, showHelp: (() => void)) {
  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  let repo = argv.repo || process.env.SURF_REPO;
  if (!repo) {
    repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
  }

  if (!repo) {
    showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;

  try {
    refInfo = await fetchAllRefsWithInfo(getNwoFromRepoUrl(repo));
  } catch (e) {
    console.log(`Failed to fetch from ${argv.r}: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  }

  let safeShas = refInfo!.map((ref) => `-${ref.object.sha.substr(0,6)}`);

  d(`safeShas: ${Array.from(safeShas).join()}`);
  let allDirs = await getAllWorkdirs(repo);
  let toDelete = allDirs.filter(
    (x) => !safeShas.find((sha) => x.indexOf(sha) > 0));

  if (argv['dry-run']) {
    toDelete.forEach((x) => console.log(x));
  } else {
    await asyncMap(toDelete, (x) => {
      d(`Burninating path '${x}'`);

      return rimraf(x)
        .catch((e) => console.error(`Tried to burn ${x} but failed: ${e.message}`));
    });
  }
}
