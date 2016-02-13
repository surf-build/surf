import './support';

import _ from 'lodash';
import path from 'path';
import { determineInterestingRefs } from '../src/github-api';
import { fs } from '../src/promisify';

describe('the determineInterestingRefs method', function() {
  beforeEach(async function() {
    this.refInfo = JSON.parse(await fs.readFile(path.join(__dirname, 'commit_info.example.json')));
  });

  it('shouldnt have pull #13 in it because its already a branch', function() {
    let result = determineInterestingRefs(this.refInfo);

    //d(JSON.stringify(result));
    expect(_.find(result, (x) => x.ref === 'refs/pull/13/head')).not.to.be.ok;
  });
});
