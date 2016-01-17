import _ from 'lodash';
import path from 'path';
import { Observable } from 'rx';
import { fs } from './promisify';

const spawnOg = require('child_process').spawn;
const isWindows = process.platform === 'win32';

const d = require('debug')('serf:promise-array');

export function asyncMap(array, selector, maxConcurrency=4) {
  return Observable.from(array)
    .map((k) =>
      Observable.defer(() =>
        Observable.fromPromise(selector(k))
          .map((v) => ({ k, v }))))
    .merge(maxConcurrency)
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

export function statSyncNoException(file) {
  try {
    return fs.statSync(file);
  } catch (e) {
    return null;
  }
}

function runDownPath(exe) {
  // NB: Windows won't search PATH looking for executables in spawn like
  // Posix does

  // Files with any directory path don't get this applied
  if (exe.match(/\\\//)) {
    return exe;
  }

  let target = path.join('.', exe);
  if (statSyncNoException(target)) {
    return target;
  }

  let haystack = process.env.PATH.split(isWindows ? ';' : ':');
  for (let p of haystack) {
    let needle = path.join(p, exe);
    if (statSyncNoException(needle)) return needle;
  }

  return target;
}

export function spawnDetached(exe, params, opts=null) {
  const newParams = [require.resolve('./spawn-child'), exe].concat(params);
  return spawn(process.execPath, newParams, _.assign({detached: true}, opts || {}));
}

export function spawn(exe, params, opts=null) {
  let spawnObs = Observable.create((subj) => {
    let proc = null;

    let fullPath = runDownPath(exe);
    if (!opts) {
      d(`spawning process: ${fullPath} ${params.join()}`);
      proc = spawnOg(fullPath, params);
    } else {
      d(`spawning process: ${fullPath} ${params.join()}, ${JSON.stringify(opts)}`);
      proc = spawnOg(fullPath, params, opts);
    }

    let stdout = '';
    let bufHandler = (b) => {
      let chunk = b.toString();

      stdout += chunk;
      subj.onNext(chunk);
    };

    proc.stdout.on('data', bufHandler);
    proc.stderr.on('data', bufHandler);
    proc.on('error', (e) => subj.onError(e));

    proc.on('close', (code) => {
      if (code === 0) {
        subj.onCompleted();
      } else {
        subj.onError(new Error(`Failed with exit code: ${code}\nOutput:\n${stdout}`));
      }
    });
  });

  return spawnObs.reduce((acc, x) => acc += x, '').toPromise();
}
