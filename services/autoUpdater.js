/**
 * Auto-update via electron-updater + GitHub Releases.
 *
 * Only runs in packaged builds. Clients poll latest.yml on the configured
 * GitHub repo; publishing a new release is how you "ship" updates.
 */
const { app } = require('electron');
const logger = require('./logger');

/** @typedef {'idle'|'checking'|'available'|'not-available'|'downloading'|'downloaded'|'error'} UpdateStatus */

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_CHECK_DELAY_MS = 4000;

/** @type {Set<(s: ReturnType<typeof getState>) => void>} */
const listeners = new Set();
let started = false;
/** @type {ReturnType<typeof setInterval> | null} */
let checkTimer = null;

function currentVersion() {
  try {
    return app.getVersion();
  } catch {
    return require('../package.json').version;
  }
}

function isPackaged() {
  try {
    return Boolean(app.isPackaged);
  } catch {
    return false;
  }
}

let state = {
  status: 'idle',
  currentVersion: currentVersion(),
  availableVersion: null,
  percent: null,
  error: null,
  packaged: isPackaged(),
};

function getState() {
  return { ...state, currentVersion: currentVersion(), packaged: isPackaged() };
}

function setState(partial) {
  state = { ...state, ...partial, currentVersion: currentVersion(), packaged: isPackaged() };
  const snapshot = getState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // ignore listener errors
    }
  }
}

function onUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  return autoUpdater;
}

function initAutoUpdater() {
  if (started) return;
  started = true;

  if (!isPackaged()) {
    logger.info('Auto-updater skipped (unpackaged / development build)');
    setState({ status: 'idle' });
    return;
  }

  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates…');
    setState({ status: 'checking', error: null, percent: null });
  });

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version });
    setState({
      status: 'available',
      availableVersion: info.version,
      error: null,
      percent: 0,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    logger.info('App is up to date', { version: info.version });
    setState({
      status: 'not-available',
      availableVersion: null,
      percent: null,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent || 0);
    setState({ status: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded; ready to install', { version: info.version });
    setState({
      status: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      error: null,
    });
  });

  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error', { message: err?.message || String(err) });
    setState({
      status: 'error',
      error: err?.message || String(err),
      percent: null,
    });
  });

  setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, INITIAL_CHECK_DELAY_MS);

  checkTimer = setInterval(() => {
    checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
  if (typeof checkTimer.unref === 'function') checkTimer.unref();
}

async function checkForUpdates() {
  if (!isPackaged()) {
    setState({ status: 'idle', error: null });
    return { ok: false, skipped: true, reason: 'unpackaged' };
  }

  try {
    const result = await getAutoUpdater().checkForUpdates();
    return { ok: true, updateInfo: result?.updateInfo || null };
  } catch (err) {
    logger.error('checkForUpdates failed', { message: err.message });
    setState({ status: 'error', error: err.message });
    return { ok: false, error: err.message };
  }
}

function quitAndInstall() {
  if (!isPackaged()) {
    return { ok: false, error: 'Solo disponible en la app instalada.' };
  }
  if (state.status !== 'downloaded') {
    return { ok: false, error: 'Todavía no hay una actualización descargada.' };
  }

  logger.info('Quitting to install update…');
  getAutoUpdater().quitAndInstall(false, true);
  return { ok: true };
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getState,
  onUpdate,
  CHECK_INTERVAL_MS,
};
