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

// Windows taskbar / notification grouping — avoid the default Electron identity
if (process.platform === 'win32') {
  app.setAppUserModelId('com.gitpushnotifier.app');
}

// Single instance — important so the OAuth callback port is not contested
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

    if (!config.github.clientId || !config.github.clientSecret) {
      logger.warn('OAuth credentials missing. Create a .env from .env.example before signing in.');
    }

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

    // Restore session
    const session = storage.getSession();
    if (session?.accessToken) {
      githubApi.setToken(session.accessToken);
      logger.info(`Restored session for ${session.user?.login || 'unknown'}`);

      // Validate token in the background
      githubApi
        .getAuthenticatedUser()
        .then((user) => {
          storage.setSession({ ...session, user });
          if (storage.getSettings().startMonitoringOnLaunch) {
            pushMonitor.start();
          }
          broadcastState();
        })
        .catch((err) => {
          logger.error('Stored token is invalid; clearing session', {
            code: err.code,
            message: err.message,
          });
          storage.clearSession();
          githubApi.clearToken();
          broadcastState();
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
