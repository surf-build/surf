import './support';

import _ from 'lodash';
import path from 'path';
import {fs} from '../src/promisify';
import determineChangedRefs from '../src/ref-differ';

const d = require('debug')('serf-test:ref-differ');

function getSeenRefs(refs) {
  return _.reduce(refs, (acc, x) => {
    acc.add(x.object.sha);
    return acc;
  }, new Set());
}

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
    let seen = getSeenRefs(this.refExamples['refs1.json']);

    let result = determineChangedRefs(
      seen,
      this.refExamples['refs1.json'],
      this.refExamples['refs2.json']);

    d(JSON.stringify(_.map(result, (x) => x.ref)));
    expect(result.length).to.equal(1);
    expect(result[0].object.sha).to.equal('a5971a6c6943154d241ad002b7240e96fa0375e6');
  });

  it('should find two changed ref between refs1 and refs3', function() {
    let seen = getSeenRefs(this.refExamples['refs1.json']);

    let result = determineChangedRefs(
      seen,
      this.refExamples['refs1.json'],
      this.refExamples['refs3.json']);

    d(JSON.stringify(_.map(result, (x) => x.ref)));
    expect(result.length).to.equal(3);
  });

  it('should find one changed ref between refs3 and refs4', function() {
    let seen = getSeenRefs(this.refExamples['refs1.json']);

    let result = determineChangedRefs(
      seen,
      this.refExamples['refs3.json'],
      this.refExamples['refs4.json']);

    d(JSON.stringify(_.map(result, (x) => x.ref)));
    expect(result.length).to.equal(1);
  });
});
