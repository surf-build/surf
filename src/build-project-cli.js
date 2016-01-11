import './babel-maybefill';

import _ from 'lodash';

const d = require('debug')('serf:serf-build');
const argv = require('yargs').argv;

async function main() {
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(`Fatal Error: ${e.message}`);
    d(e.stack);
    process.exit(-1);
  });
