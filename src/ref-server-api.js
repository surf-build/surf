import _ from 'lodash';
import path from 'path';
import express from 'express';
import {Disposable} from 'rx';
import pkgJson from '../package.json';
import createLRU from 'lru-cache';

import {fetchAllRefsWithInfo} from './github-api';
const d = require('debug')('surf:ref-server-api');

function setupRouting(app, validNwos) {
  let bulma = path.resolve(__dirname, '..', 'node_modules', 'bulma', 'css');

  let serverList = createLRU({ max: 1000 });

  app.use('/bulma', express.static(bulma));
  app.get('/', (req, res) => {
    let servers = _.map(serverList.values(), (server) => {
      let extraInfo = {};
      if (Date.now() - server.lastChecked > 4 * 60 * 1000) {
        extraInfo.failed = true;
      }
      
      return _.assign(extraInfo, server);
    });
    
    res.render('status', {
      version: pkgJson.version,
      serversAreDown: _.find(servers, (x) => x.failed),
      serverList: servers.length > 0 ? servers : null
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
      
      let serverInfo = {
        nwo: needle,
        lastChecked: new Date()
      };
      
      if (req.query.buildName) {
        serverInfo.nwo = `${req.query.buildName} - ${needle}`;
      }
      
      serverList.set(needle, serverInfo, 6 * 60 * 60 * 1000);
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
