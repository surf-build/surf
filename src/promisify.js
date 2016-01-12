import _ from 'lodash';
import pify from 'pify';

const toImport = [
  'mkdirp',
  'rimraf',
  'fs'
];

module.exports = _.reduce(toImport, (acc,x) => {
  acc[x] = pify(require(x));
  return acc;
}, {});
