/**
 * Patches node_modules/electron/dist/electron.exe so the Windows taskbar
 * shows our app icon when running via `npm start` / `electron .`.
 */
const path = require('path');
const fs = require('fs');
const rcedit = require('@develar/rcedit');

const electronExe = require('electron');
const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

if (process.platform !== 'win32') {
  console.log('Skipping electron icon patch (Windows only)');
  process.exit(0);
}

if (!fs.existsSync(electronExe)) {
  console.error('electron.exe not found:', electronExe);
  process.exit(1);
}

if (!fs.existsSync(iconPath)) {
  console.error('Icon not found:', iconPath);
  process.exit(1);
}

rcedit(electronExe, { icon: iconPath }, (err) => {
  if (err) {
    console.error('Failed to set electron.exe icon:', err);
    process.exit(1);
  }
  console.log('Set taskbar icon on', electronExe);
});
