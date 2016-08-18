import _ from 'lodash';
import path from 'path';
import { Observable } from 'rxjs';
import { fs } from './promisify';

const sfs = require('fs');

export function asyncMap(array, selector, maxConcurrency=4) {
  return Observable.from(array)
    .map((k) =>
      Observable.defer(() =>
        Observable.fromPromise(selector(k))
          .map((v) => ({ k, v }))))
    .mergeAll(maxConcurrency)
    .reduce((acc, kvp) => {
      acc[kvp.k] = kvp.v;
      return acc;
    }, {})
    .toPromise();
}

export async function asyncReduce(array, selector, seed) {
  let acc = seed;
  for (let x of array) {
    acc = await selector(acc, x);
  }

  return acc;
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function retryPromise(func) {
  return Observable.defer(() => 
      Observable.fromPromise(func()))
    .retry(3)
    .toPromise();
}

export async function statNoException(file) {
  try {
    return await fs.stat(file);
  } catch (e) {
    return null;
  }
}

export function statSyncNoException(file) {
  try {
    return sfs.statSync(file);
  } catch (e) {
    return null;
  }
}

export async function readdirRecursive(dir) {
  let acc = [];

  for (let entry of await fs.readdir(dir)) {
    let target = path.resolve(dir, entry);
    let stat = await statNoException(target);

    if (stat && stat.isDirectory()) {
      let entries = await readdirRecursive(target);
      _.each(entries, (x) => acc.push(x));
    } else {
      acc.push(target);
    }
  }

  return acc;
}
