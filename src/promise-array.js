import _ from 'lodash';
import path from 'path';
import net from 'net';
import { Observable, Disposable } from 'rx';
import { fs } from './promisify';

const spawnOg = require('child_process').spawn;
const isWindows = process.platform === 'win32';
const sfs = require('fs');

const d = require('debug')('surf:promise-array');

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

function runDownPath(exe) {
  // NB: Windows won't search PATH looking for executables in spawn like
  // Posix does

  // Files with any directory path don't get this applied
  if (exe.match(/[\\\/]/)) {
    d('Path has slash in directory, bailing');
    return exe;
  }

  let target = path.join('.', exe);
  if (statSyncNoException(target)) {
    d(`Found executable in currect directory: ${target}`);
    return target;
  }

  let haystack = process.env.PATH.split(isWindows ? ';' : ':');
  for (let p of haystack) {
    let needle = path.join(p, exe);
    if (statSyncNoException(needle)) return needle;
  }

  d('Failed to find executable anywhere in path');
  return exe;
}

export function spawnDetached(exe, params, opts=null) {
  if (!isWindows) return spawn(exe, params, _.assign({}, opts || {}, {detached: true }));
  const newParams = [exe].concat(params);

  let target = path.join(__dirname, '..', 'vendor', 'jobber', 'jobber.exe');
  let options = _.assign({}, opts || {}, { detached: true, jobber: true });

  d(`spawnDetached: ${target}, ${newParams}`);
  return spawn(target, newParams, options);
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
      proc = spawnOg(fullPath, params, _.omit(opts, 'jobber'));
    }

    let stdout = '';
    let bufHandler = (b) => {
      if (b.length < 1) return;
      let chunk = b.toString();

      stdout += chunk;
      subj.onNext(chunk);
    };

    let noClose = false;
    proc.stdout.on('data', bufHandler);
    proc.stderr.on('data', bufHandler);
    proc.on('error', (e) => {
      noClose = true;
      subj.onError(e);
    });

    proc.on('close', (code) => {
      noClose = true;
      if (code === 0) {
        subj.onCompleted();
      } else {
        subj.onError(new Error(`Failed with exit code: ${code}\nOutput:\n${stdout}`));
      }
    });

    return Disposable.create(() => {
      if (noClose) return;

      d(`Killing process: ${fullPath} ${params.join()}`);
      if (!opts.jobber) {
        proc.kill();
        return;
      }

      // NB: Connecting to Jobber's named pipe will kill it
      net.connect(`\\\\.\\pipe\\jobber-${proc.pid}`);
      setTimeout(() => proc.kill(), 5*1000);
    });
  });

  return spawnObs.reduce((acc, x) => acc += x, '').publishLast().refCount();
}
