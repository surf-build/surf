import './babel-maybefill';

import express from 'express';
import {fetchAllRefsWithInfo} from './github-api';
import _ from 'lodash';

const d = require('debug')('serf:ref-server');
const app = express();

const yargs = require('yargs')
  .usage('serf-server owner/repo owner2/repo owner/repo3...')
  .help('h')
  .alias('p', 'port')
  .describe('p', 'The port to start the server on')
  .alias('h', 'help')
  .epilog(`
Some useful environment variables:

SERF_PORT - the port to serve on if not specified via -p, defaults to 3000.
GITHUB_TOKEN - the GitHub API token to use. Must be provided.`);

const argv = yargs.argv;

function main() {
  const validNwos = argv._;
  if (validNwos.length < 1) {
    console.error("ERROR: Supply a list of valid repositories in owner/repo format (i.e. 'rails/rails')\n");
    yargs.showHelp();
    process.exit(-1);
  }
  
  app.get('/info/:owner/:name', async (req, res) => {
    try {
      if (!req.params.owner || !req.params.name) {
        throw new Error("no");
      }
      
      let needle = `${req.params.owner}/${req.params.name}`;
      if (!_.find(validNwos, (x) => x === needle)) {
        throw new Error("no");
      }
      
      res.json(await fetchAllRefsWithInfo(needle));
    } catch (e) {
      d(e.message);
      d(e.stack);
      res.status(500).json({error: e.message});
    }
  });

  let port = argv.port || 3000;
  console.log(`Listening on port ${port}`);
  app.listen(port);
}

main();
