import * as ogM from 'mkdirp';
import * as ogR from 'rimraf';

export function mkdirpSync(dir: string) {
  ogM.sync(dir);
}

export function mkdirp(dir: string): Promise<string> {
  return new Promise<string>((res,rej) => {
    ogM(dir, (err: Error) => {
      if (err) { rej(err); } else { res(dir); }
    });
  });
}

export function rimrafSync(dir: string) {
  ogR.sync(dir);
}

export function rimraf(dir: string): Promise<void> {
  return new Promise<void>((res,rej) => {
    ogR(dir, (err: Error) => {
      if (err) { rej(err); } else { res(); }
    });
  });
}