import {Observable, Disposable} from 'rx';

Observable.prototype.subUnsub = function(onSub=null, onUnsub=null) { 
  return Observable.create((subj) => {
    if (onSub) onSub();
    let d = this.subscribe(subj);
    
    return Disposable.create(() => {
      if (onUnsub) onUnsub();
      d.dispose();
    });
  });
};

Observable.prototype.permaRefcount = function() {
  let connected = null;
  
  return Observable.create((subj) => {
    let d = this.subscribe(subj);
    if (!connected) connected = this.connect();

    return d;
  });
};

Observable.prototype.delayFailures = function(delayTime) {
  return this
    .catch((e) => {
      return Observable.timer(delayTime)
        .flatMap(() => Observable.throw(e));
    });
};
