import {Observable} from 'rx';

export function asyncMap(array, selector) {
  return Observable.from(array)
    .map((k) => 
      Observable.defer(() => 
        Observable.fromPromise(selector(k))
          .map((v) => ({ k, v }))))
    .merge(4)
    .reduce((acc, kvp) => {
      acc[kvp.k] = kvp.v;
      return acc;
    }, {})
    .toPromise();
}
