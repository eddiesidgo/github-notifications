/**
 * electron-builder afterPack hook.
 * With signAndEditExecutable: false, the builder skips rcedit — so we
 * stamp our icon onto the packaged .exe ourselves. NSIS desktop / Start
 * Menu shortcuts use that exe icon.
 */
const path = require('path');
const fs = require('fs');
const rcedit = require('@develar/rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found:', exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[afterPack] icon not found:', iconPath);
    return;
  }

  await new Promise((resolve, reject) => {
    rcedit(exePath, { icon: iconPath }, (err) => (err ? reject(err) : resolve()));
  });

  console.log('[afterPack] Set shortcut/exe icon on', exeName);
};
