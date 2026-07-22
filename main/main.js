/**
 * Electron main process entry point for GitPushNotifier.
 */
const { app, Menu } = require('electron');
const { config } = require('../config');
const storage = require('../storage/store');
const logger = require('../services/logger');
const { githubApi } = require('../services/githubApi');
const pushMonitor = require('../services/pushMonitor');
const { createMainWindow, getMainWindow } = require('./window');
const { destroyTray, showMainFromTray, wireMinimizeToTray, createTray } = require('./tray');
const { destroySoundPlayer } = require('../notifications/soundPlayer');
const { registerIpcHandlers, broadcastState } = require('./ipc');
const { applyOpenAtLogin, shouldStartHidden } = require('./loginItem');
const { initAutoUpdater } = require('../services/autoUpdater');

const SESSION_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

/**
 * Validate a restored token. Retries on transient/network errors.
 * Only TOKEN_INVALID is treated as fatal (session should be cleared).
 */
async function validateStoredSession(session) {
  let lastError = null;

  for (let attempt = 0; attempt < SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const user = await githubApi.getAuthenticatedUser();
      storage.setSession({ ...session, user });
      return { ok: true, user };
    } catch (err) {
      lastError = err;
      if (err?.code === 'TOKEN_INVALID') {
        return { ok: false, fatal: true, err };
      }

      const willRetry = attempt < SESSION_RETRY_DELAYS_MS.length - 1;
      const nextDelay = willRetry ? SESSION_RETRY_DELAYS_MS[attempt] : null;
      logger.warn('Session validation failed; keeping stored session', {
        code: err?.code,
        message: err?.message,
        attempt: attempt + 1,
        nextRetryMs: nextDelay,
      });

      if (willRetry) {
        await new Promise((resolve) => setTimeout(resolve, nextDelay));
      }
    }
  }

  return { ok: false, fatal: false, err: lastError };
}

// Windows taskbar / notification grouping — avoid the default Electron identity
if (process.platform === 'win32') {
  app.setAppUserModelId('com.gitpushnotifier.app');
}

// Single instance — avoid duplicate tray / polling when launched twice
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainFromTray();
    const win = getMainWindow();
    if (!win) createMainWindow();
  });

  app.whenReady().then(() => {
    logger.init();
    logger.info(`${config.appName} starting`);

    Menu.setApplicationMenu(null);
    registerIpcHandlers();

    // Register / refresh Windows startup entry from saved preference
    const settings = storage.getSettings();
    applyOpenAtLogin(settings.openAtLogin !== false);

    const startHidden = shouldStartHidden();
    const win = createMainWindow({ startHidden });
    wireMinimizeToTray(win, () => storage.getSettings().minimizeToTray !== false);

    if (startHidden) {
      logger.info('Started hidden (Windows startup / --hidden)');
    }

    createTray({
      onShow: () => {
        let current = getMainWindow();
        if (!current) current = createMainWindow();
        showMainFromTray();
      },
      onQuit: () => {
        app.isQuitting = true;
        app.quit();
      },
      onToggleMonitor: () => {
        if (pushMonitor.getStatus().running) pushMonitor.stop();
        else if (storage.getSession()?.accessToken) pushMonitor.start();
        broadcastState();
      },
      isMonitoring: () => pushMonitor.getStatus().running,
    });

    // Restore session — keep it unless GitHub confirms the token is invalid (401).
    // Network errors at Windows startup must not wipe the PAT.
    const session = storage.getSession();
    if (session?.accessToken) {
      githubApi.setToken(session.accessToken);
      logger.info(`Restored session for ${session.user?.login || 'unknown'}`);

      if (storage.getSettings().startMonitoringOnLaunch) {
        pushMonitor.start();
      }
      broadcastState();

      validateStoredSession(session).then((result) => {
        if (result.ok) {
          broadcastState();
          return;
        }

        if (result.fatal) {
          logger.error('Stored token is invalid; clearing session', {
            code: result.err?.code,
            message: result.err?.message,
          });
          storage.clearSession();
          githubApi.clearToken();
          pushMonitor.stop();
          broadcastState();
          return;
        }

        logger.warn('Could not validate session after retries; keeping stored credentials', {
          code: result.err?.code,
          message: result.err?.message,
        });
      });
    }

    initAutoUpdater();

    app.on('activate', () => {
      if (!getMainWindow()) createMainWindow();
      else showMainFromTray();
    });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    pushMonitor.stop();
    destroySoundPlayer();
    destroyTray();
  });

  app.on('window-all-closed', () => {
    // Do not quit — the tray keeps the app alive on Windows.
    // Explicit exit happens from the tray "Salir" action (app.isQuitting).
  });
}
