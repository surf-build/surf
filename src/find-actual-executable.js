import path from 'path';

export default function findActualExecutable(fullPath, args) {
  // POSIX can just execute scripts directly, no need for silly goosery
  if (process.platform !== 'win32') return { cmd: fullPath, args: args };

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
