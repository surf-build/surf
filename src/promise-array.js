import {Observable} from 'rx';
const spawnOg = require('child_process').spawn;

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

export function asyncReduce(array, selector, seed) {
  return Observable.from(array)
    .map((k) =>
      Observable.defer(() =>
        Observable.fromPromise(selector(k))
          .map((v) => ({ k, v }))))
    .merge(4)
    .reduce(selector, seed)
    .toPromise();
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Public: Maps a process's output into an {Observable}
//
// exe - The program to execute
// params - Arguments passed to the process
// opts - Options that will be passed to child_process.spawn
//
// Returns a {Promise} with a single value, that is the output of the
// spawned process
export function spawn(exe, params, opts=null) {
  let spawnObs = Observable.create((subj) => {
    let proc = null;

    if (!opts) {
      proc = spawnOg(exe, params);
    } else {
      proc = spawnOg(exe, params, opts);
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
