var cp = require('child_process');

var cmd = process.argv[2];
var argv = process.argv.splice(3);

var proc = cp.spawn(cmd, argv, { stdio: 'inherit', env: process.env, cwd: undefined });

proc.on('exit', function(code) {
  process.exit(code);
});

proc.on('error', function(e) {
  console.error(e.message);
  process.exit(-1);
});
