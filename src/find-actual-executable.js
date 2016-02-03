import _ from 'lodash';
import path from 'path';
import sfs from 'fs';

export default function findActualExecutable(fullPath, args) {
  // POSIX can just execute scripts directly, no need for silly goosery
  if (process.platform !== 'win32') return { cmd: fullPath, args: args };
  
  // NB: When you write something like `surf-client ... -- surf-build` on Windows,
  // a shell would normally convert that to surf-build.cmd, but since it's passed
  // in as an argument, it doesn't happen
  if (!sfs.existsSync(fullPath)) {
    const possibleExts = ['.exe', '.bat', '.cmd', '.ps1'];
    let realExecutable = _.find(possibleExts, (x) => sfs.existsSync(`${fullPath}${x}`));
    
    if (realExecutable) {
      return findActualExecutable(realExecutable, args);
    }
  }

  if (fullPath.match(/\.ps1$/i)) {
    let cmd = path.join(process.env.SYSTEMROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'PowerShell.exe');
    let psargs = ['-ExecutionPolicy', 'Unrestricted', '-NoLogo', '-NonInteractive', '-File', fullPath];

    return { cmd: cmd, args: psargs.concat(args) };
  }

  if (fullPath.match(/\.(bat|cmd)$/i)) {
    let cmd = path.join(process.env.SYSTEMROOT, 'System32', 'cmd.exe');
    let cmdArgs = ['/C', fullPath];

    return { cmd: cmd, args: cmdArgs.concat(args) };
  }

  if (fullPath.match(/\.(js)$/i)) {
    let cmd = process.execPath;
    let nodeArgs = [fullPath];

    return { cmd: cmd, args: nodeArgs.concat(args) };
  }

  // Dunno lol
  return { cmd: fullPath, args: args };
}
