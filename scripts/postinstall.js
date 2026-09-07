'use strict';
const { execSync } = require('child_process');

if (process.platform === 'darwin') {
  try {
    execSync('xattr -cr node_modules/electron/dist/', { stdio: 'ignore' });
  } catch {}
  try {
    execSync('codesign --force --deep --sign - node_modules/electron/dist/Electron.app', { stdio: 'ignore' });
  } catch {}
}
// Windows and Linux: nothing to do
