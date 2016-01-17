var cp = require('child_process');

var cmd = process.argv[2];
var argv = process.argv.splice(3);
<<<<<<< HEAD

var proc = cp.spawn(cmd, argv, { detached: false, stdio: ['pipe', 'inherit', 'inherit'], env: process.env, cwd: undefined });
=======
console.error("cmd: " + cmd);
console.error("argv: " + argv.join());

var proc = cp.spawn(cmd, argv, { stdio: 'inherit', env: process.env, cwd: undefined });
>>>>>>> more debuggery

proc.on('exit', function(code) {
  process.exit(code);
});

proc.on('error', function(e) {
  console.error(e.message);
  process.exit(-1);
});

process.stdin.on('data', function(chunk) {
  if (chunk.toString().match('__die__')) {
    process.exit(-1);
  }

  proc.stdin.write(chunk);
});
