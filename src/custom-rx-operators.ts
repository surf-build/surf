import { Observable, Subscription, Observer, ConnectableObservable } from 'rxjs';

export function subUnsub<T>(this: Observable<T>, onSub?: Function, onUnsub?: Function) {
  return Observable.create((subj: Observer<T>) => {
    if (onSub) onSub();
    let d = this.subscribe(subj);

    return new Subscription(() => {
      if (onUnsub) onUnsub();
      d.unsubscribe();
    });
  });
}

export function permaRefcount<T>(this: ConnectableObservable<T>) {
  let connected: Subscription;

  return Observable.create((subj: Observer<T>) => {
    let d = this.subscribe(subj);
    if (!connected) connected = this.connect();

    return d;
  });
}

export function delayFailures<T>(this: Observable<T>, delayTime: number) {
  return this
    .catch((e) => {
      return Observable.timer(delayTime)
        .flatMap(() => Observable.throw(e));
    });
}

declare module 'rxjs/Observable' {
  interface Observable<T> {
    subUnsub: typeof subUnsub;
    permaRefcount: typeof permaRefcount;
    delayFailures: typeof delayFailures;
  }
}

Observable.prototype.subUnsub = subUnsub;
Observable.prototype.permaRefcount = permaRefcount;
Observable.prototype.delayFailures = delayFailures;