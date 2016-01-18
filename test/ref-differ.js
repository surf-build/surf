import './support';

import _ from 'lodash';
import path from 'path';
import {fs} from '../src/promisify';
import determineChangedRefs from '../src/ref-differ';

describe.only('ref differ', function() {
  beforeEach(async function() {
    let acc = {};
    let fixturesDir = path.join(__dirname, '..', 'fixtures');

    for (let name of await fs.readdir(fixturesDir)) {
      if (!name.match(/^refs.*\.json$/i)) continue;

      let contents = await fs.readFile(path.join(fixturesDir, name), 'utf8');
      acc[name] = JSON.parse(contents.split('\n')[0]);
    }

    this.refExamples = acc;
  });

  it('should find one changed ref between refs1 and refs2', function() {
    let seen = _.reduce(this.refExamples['refs1.json'], (acc, x) => {
      acc.add(x.object.sha);
      return acc;
    }, new Set());

    let result = determineChangedRefs(
      seen,
      this.refExamples['refs1.json'],
      this.refExamples['refs2.json']);

    expect(result.length).to.equal(1);
    expect(result[0].object.sha).to.equal('a5971a6c6943154d241ad002b7240e96fa0375e6');
  });
});
