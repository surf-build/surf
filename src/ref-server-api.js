import _ from 'lodash';
import path from 'path';
import express from 'express';
import {Disposable} from 'rx';
import pkgJson from '../package.json';

import {fetchAllRefsWithInfo} from './github-api';
const d = require('debug')('surf:ref-server-api');

function setupRouting(app, validNwos) {
  let bulma = path.resolve(__dirname, '..', 'node_modules', 'bulma', 'css');

  app.use('/bulma', express.static(bulma));
  app.get('/', (req, res) => {
    res.render('status', {
      version: pkgJson.version,
      serversAreDown: true,
      serverList: [
        {
          nwo: 'surf-build/surf',
          lastChecked: (new Date()).toLocaleString(),
          failed: true
        },
        {
          nwo: 'rails/rails',
          lastChecked: (new Date()).toLocaleString()
        }
      ]
    });
  });

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
}

export default function createRefServer(validNwos, port=null) {
  const app = express();
  app.set('view engine', 'jade');

  setupRouting(app, validNwos);
  
  port = port || process.env.SURF_PORT || '3000';

  if (typeof(port) === 'string') {
    port = parseInt(port);
  }
  
  let server = app.listen(port);
  return Disposable.create(() => server.close(() => {}));
}
