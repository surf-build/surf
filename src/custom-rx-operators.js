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
