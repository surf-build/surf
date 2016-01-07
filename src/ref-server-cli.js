import './babel-maybefill';

import express from 'express';
import {fetchAllRefsWithInfo} from './github-api';
import _ from 'lodash';

const d = require('debug')('serf:ref-server');
const app = express();

const argv = require('yargs').argv;

function main() {
  const validNwos = argv._;
  if (validNwos.length < 1) {
    console.error("Supply a list of valid repositories in owner/repo format (i.e. 'rails/rails')");
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
