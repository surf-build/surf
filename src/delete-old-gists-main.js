import {getAllGists, getAllGistsLazy, deleteGist, getNwoFromRepoUrl} from './github-api';
import {asyncMap} from './promise-array';
import {Observable} from 'rxjs';

export function getGistsToDelete(repoUrl, obs=null) {
  let nwo = getNwoFromRepoUrl(repoUrl);
  let since = new Date((new Date()).getTime() - (1000*60*60*24*4));

  return (obs || getAllGistsLazy())
    .concatMap(({current, next}) => {
      current = current
        .filter(({description, created_at, url}) => {
          let pred = true;

          console.log(`Looking at ${description}`);
          pred = pred && (description.indexOf(nwo) > 0 || description.indexOf('undefined') > 0);
          if (pred) console.log(`Matches! Looking at ${created_at}`);
          pred = pred && (new Date(created_at)) < since;
          if (pred) console.log(`Yielding ${url}`);
          return pred;
        });

      return Observable.of(...current).concat(getGistsToDelete(repoUrl, next));
    });
}

export async function deleteOldGists(repoUrl) {
  while (true) {
    let result = await getGistsToDelete(repoUrl).take(64)
      .toArray()
      .toPromise();

    if (result.length < 1) break;

    console.log(`About to delete ${result.map(x => x.url).join(',')}`);
    await asyncMap(result, (g) => deleteGist(g));
  }
}

export default async function main() {
  let allGists = await getAllGists();
  let since = new Date((new Date()).getTime() - (1000*60*60*24*21));

  let toDelete = allGists.filter((x) => {
    return (new Date(x.created_at)) < since;
  });

  for (let gist of allGists) {
    console.log(`${gist.url} - ${gist.updated_at}`);
  }

  await asyncMap(toDelete, (g) => deleteGist(g));
}
