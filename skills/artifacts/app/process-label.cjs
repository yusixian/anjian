'use strict';

let version;
try {
  ({ version } = require('../../../package.json'));
} catch {
  // A copied launcher can run without the plugin manifest.
}

function labelProcess(role, identity) {
  if (process.platform === 'win32') return;
  process.title = ['Anjian', version, role, identity].filter(Boolean).join(' ');
}

module.exports = { labelProcess };
