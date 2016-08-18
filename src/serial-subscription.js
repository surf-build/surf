export default class SerialSubscription {
  constructor(innerSub=null) {
    this.isUnsubscribed = false;
    this.innerSub = innerSub;
  }
  
  get() { return this.innerSub; }
  
  set(newSub) {
    if (this.isUnsubscribed) return;
    if (this.innerSub) this.innerSub.unsubscribe();
    this.innerSub = newSub;
  }
  
  unsubscribe() {
    if (this.isUnsubscribed) return;
    
    if (this.innerSub) this.innerSub.unsubscribe();
    this.isUnsubscribed = true;
  }
}
