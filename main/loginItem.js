/**
 * Windows startup (Login Item) helpers via Electron.
 * Registers the app so it launches when the user signs in.
 */
const path = require('path');
const { app } = require('electron');

/**
 * Sync OS login-item registration with the given preference.
 * @param {boolean} enabled
 */
function applyOpenAtLogin(enabled) {
  if (process.platform !== 'win32') return;

  const openAtLogin = Boolean(enabled);
  const opts = {
    openAtLogin,
    openAsHidden: true,
  };

  if (app.isPackaged) {
    // Installed .exe — Windows will start this binary from the Startup registry entry
    opts.args = openAtLogin ? ['--hidden'] : [];
  } else {
    // Dev: Electron.exe needs the app path as first argument
    opts.path = process.execPath;
    opts.args = openAtLogin
      ? [path.resolve(process.argv[1] || app.getAppPath()), '--hidden']
      : [];
  }

  app.setLoginItemSettings(opts);
}

function isOpenAtLoginEnabled() {
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch {
    return false;
  }
}

/** True when Windows (or our --hidden flag) launched the app at login. */
function shouldStartHidden() {
  if (process.argv.includes('--hidden')) return true;
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  } catch {
    return false;
  }
}

module.exports = {
  applyOpenAtLogin,
  isOpenAtLoginEnabled,
  shouldStartHidden,
};
