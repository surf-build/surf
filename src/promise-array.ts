import * as path from 'path';
import * as fs from 'mz/fs';

import { Observable } from 'rxjs';

// tslint:disable-next-line:no-var-requires
const sfs = require('fs');

export function asyncMap<T, TRet>(
    array: T[],
    selector: ((x: T) => Promise<TRet>),
    maxConcurrency = 4): Promise<Map<T, TRet>> {
  return Observable.from(array)
    .map((k) =>
      Observable.defer(() =>
        Observable.fromPromise(selector(k))
          .map((v) => ({ k, v }))))
    .mergeAll(maxConcurrency)
    .reduce((acc, kvp) => {
      acc.set(kvp.k, kvp.v);
      return acc;
    }, new Map())
    .toPromise();
}

export async function asyncReduce<T, TAcc>(
    array: T[],
    selector: ((acc: TAcc, x: T) => TAcc),
    seed: TAcc) {
  let acc = seed;
  for (let x of array) {
    acc = await selector(acc, x);
  }

  return acc;
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function retryPromise(func: (() => Promise<any>)) {
  return Observable.defer(() =>
      Observable.fromPromise(func()))
    .retry(3)
    .toPromise();
}

export async function statNoException(file: string): Promise<fs.Stats | null> {
  try {
    return await fs.stat(file);
  } catch (e) {
    return null;
  }
}

export function statSyncNoException(file: string): fs.Stats | null {
  try {
    return sfs.statSync(file);
  } catch (e) {
    return null;
  }
}

export async function readdirRecursive(dir: string): Promise<string[]> {
  let acc: string[] = [];

  for (let entry of await fs.readdir(dir)) {
    let target = path.resolve(dir, entry);
    let stat = await statNoException(target);

    if (stat && stat.isDirectory()) {
      let entries = await readdirRecursive(target);
      entries.forEach((x) => acc.push(x));
    } else {
      acc.push(target);
    }
  }

  return acc;
}
