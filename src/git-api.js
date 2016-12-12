import {findActualExecutable} from 'spawn-rx';

const d = require('debug')('surf:git-api');

const shouldUseGitExe = process.env.SURF_FORCE_GIT_EXECUTABLE || findActualExecutable('git', []).cmd !== 'git';

if (shouldUseGitExe && !process.env.SURF_FORCE_NODE_GIT) {
  d('Using git executable');
  module.exports = require('./git-cmd-api');
} else {
  d('Using libgit2');
  module.exports = require('./git-nodegit-api');
}