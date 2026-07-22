/**
 * IPC handlers connecting the renderer UI to main-process services.
 */
const { app, ipcMain, dialog } = require('electron');
const storage = require('../storage/store');
const { loginWithPat, AuthError } = require('../services/githubAuth');
const { githubApi, GitHubApiError } = require('../services/githubApi');
const pushMonitor = require('../services/pushMonitor');
const {
  notifyTest,
  installCustomSound,
  clearCustomSound,
  playConfiguredSound,
  getSoundInfo,
} = require('../notifications/notifier');
const logger = require('../services/logger');
const { sendToRenderer } = require('./window');
const { refreshTrayMenu } = require('./tray');
const { config } = require('../config');
const { applyOpenAtLogin } = require('./loginItem');
const autoUpdaterService = require('../services/autoUpdater');

async function establishSession({ accessToken, scope, authMethod }) {
  githubApi.setToken(accessToken);
  const user = await githubApi.getAuthenticatedUser();
  storage.setSession({
    accessToken,
    scope,
    authMethod,
    user,
    loggedInAt: new Date().toISOString(),
  });
  logger.info(`Signed in as ${user.login} via ${authMethod}`);

  const settings = storage.getSettings();
  if (settings.startMonitoringOnLaunch) {
    pushMonitor.start();
  }

  broadcastState();
  return { ok: true, user };
}

const POLL_INTERVAL_MIN_MS = 10_000;
const POLL_INTERVAL_MAX_MS = 3_600_000;

function defaultPollIntervalMs() {
  const fn = config.monitor.getPollIntervalMs;
  const value = typeof fn === 'function' ? fn.call(config.monitor) : Number(fn);
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function resolvePollIntervalMs() {
  const fromSettings = Number(storage.getSettings()?.pollIntervalMs);
  if (Number.isFinite(fromSettings) && fromSettings > 0) {
    return fromSettings;
  }
  return defaultPollIntervalMs();
}

function buildState() {
  const session = storage.getSession();
  return {
    appName: config.appName,
    authenticated: Boolean(session?.accessToken),
    user: session?.user || null,
    authMethod: session?.authMethod || null,
    monitoredRepos: storage.getMonitoredRepos(),
    monitor: pushMonitor.getStatus(),
    pushState: storage.getAllForUi().pushState,
    settings: storage.getSettings(),
    sound: getSoundInfo(),
    pollIntervalMs: resolvePollIntervalMs(),
    update: autoUpdaterService.getState(),
    appVersion: app.getVersion(),
  };
}

function broadcastState() {
  sendToRenderer('app:state', buildState());
  refreshTrayMenu();
}

function registerIpcHandlers() {
  ipcMain.handle('app:getState', async () => buildState());

  ipcMain.handle('auth:loginWithPat', async (_event, rawToken) => {
    try {
      const token = await loginWithPat(rawToken);
      return await establishSession({
        accessToken: token.accessToken,
        scope: token.scope,
        authMethod: 'pat',
      });
    } catch (err) {
      const message =
        err instanceof AuthError || err instanceof GitHubApiError
          ? err.message
          : err.message || 'PAT login failed';
      logger.error('PAT login failed', { code: err.code, message });
      return { ok: false, error: message, code: err.code || 'AUTH_PAT_FAILED' };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    pushMonitor.stop();
    githubApi.clearToken();
    storage.clearSession();
    logger.info('Signed out');
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('repos:add', async (_event, fullName) => {
    try {
      if (!storage.getSession()?.accessToken) {
        return { ok: false, error: 'Debes iniciar sesión primero.', code: 'NOT_AUTHENTICATED' };
      }

      const cleaned = String(fullName || '')
        .trim()
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\.git$/i, '')
        .replace(/\/$/, '');

      const [owner, name] = cleaned.split('/');
      if (!owner || !name || cleaned.split('/').length !== 2) {
        return {
          ok: false,
          error: 'Usa el formato owner/repo (ej. octocat/Hello-World).',
          code: 'INVALID_REPO',
        };
      }

      const repo = await githubApi.getRepository(owner, name);
      const result = storage.addMonitoredRepo({
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        htmlUrl: repo.htmlUrl,
        addedAt: new Date().toISOString(),
      });

      if (!result.added) {
        return { ok: false, error: 'Ese repositorio ya está en la lista.', code: 'DUPLICATE' };
      }

      logger.info(`Monitoring ${repo.fullName}`);
      if (!pushMonitor.getStatus().running) {
        pushMonitor.start();
      } else {
        await pushMonitor.pollOnce();
      }

      broadcastState();
      return { ok: true, repos: result.repos };
    } catch (err) {
      const message =
        err instanceof GitHubApiError ? err.message : err.message || 'No se pudo agregar el repo';
      logger.error('Add repo failed', { code: err.code, message });
      return { ok: false, error: message, code: err.code || 'ADD_REPO_FAILED' };
    }
  });

  ipcMain.handle('repos:list', async () => {
    try {
      if (!storage.getSession()?.accessToken) {
        return { ok: false, error: 'Debes iniciar sesión primero.', code: 'NOT_AUTHENTICATED' };
      }

      const repos = await githubApi.listUserRepos({ perPage: 50, maxPages: 4 });

      const monitored = new Set(
        storage.getMonitoredRepos().map((r) => String(r.fullName || `${r.owner}/${r.name}`).toLowerCase())
      );

      return {
        ok: true,
        repos: repos.map((repo) => ({
          ...repo,
          alreadyMonitored: monitored.has(String(repo.fullName).toLowerCase()),
        })),
      };
    } catch (err) {
      const message =
        err instanceof GitHubApiError ? err.message : err.message || 'No se pudieron listar los repos';
      logger.error('List repos failed', { code: err.code, message });
      return { ok: false, error: message, code: err.code || 'LIST_REPOS_FAILED' };
    }
  });

  ipcMain.handle('repos:remove', async (_event, { owner, name }) => {
    const repos = storage.removeMonitoredRepo(owner, name);
    logger.info(`Stopped monitoring ${owner}/${name}`);
    broadcastState();
    return { ok: true, repos };
  });

  ipcMain.handle('monitor:start', async () => {
    if (!storage.getSession()?.accessToken) {
      return { ok: false, error: 'Debes iniciar sesión primero.' };
    }
    pushMonitor.start();
    broadcastState();
    return { ok: true, monitor: pushMonitor.getStatus() };
  });

  ipcMain.handle('monitor:stop', async () => {
    pushMonitor.stop();
    broadcastState();
    return { ok: true, monitor: pushMonitor.getStatus() };
  });

  ipcMain.handle('monitor:pollNow', async () => {
    try {
      await pushMonitor.pollOnce();
      broadcastState();
      return { ok: true, monitor: pushMonitor.getStatus() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:setPollInterval', async (_event, ms) => {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < POLL_INTERVAL_MIN_MS || value > POLL_INTERVAL_MAX_MS) {
      return {
        ok: false,
        error: `El intervalo debe estar entre ${POLL_INTERVAL_MIN_MS / 1000}s y ${POLL_INTERVAL_MAX_MS / 1000}s.`,
        code: 'INVALID_POLL_INTERVAL',
      };
    }
    const pollIntervalMs = Math.round(value);
    storage.setSettings({ pollIntervalMs });
    logger.info('Poll interval updated', { pollIntervalMs });
    pushMonitor.reschedule();
    broadcastState();
    return { ok: true, pollIntervalMs };
  });

  ipcMain.handle('settings:setOpenAtLogin', async (_event, enabled) => {
    const openAtLogin = Boolean(enabled);
    storage.setSettings({ openAtLogin });
    applyOpenAtLogin(openAtLogin);
    logger.info('Open at login updated', { openAtLogin });
    broadcastState();
    return { ok: true, openAtLogin };
  });

  ipcMain.handle('notify:test', async () => {
    const shown = await notifyTest();
    return { ok: shown };
  });

  ipcMain.handle('sound:choose', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Elegir sonido de notificación (MP3)',
        properties: ['openFile'],
        filters: [{ name: 'Audio MP3', extensions: ['mp3'] }],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { ok: false, cancelled: true };
      }
      const installed = installCustomSound(result.filePaths[0]);
      broadcastState();
      return { ok: true, sound: installed };
    } catch (err) {
      logger.error('Failed to install custom sound', { message: err.message });
      return { ok: false, error: err.message, code: err.code || 'SOUND_INSTALL_FAILED' };
    }
  });

  ipcMain.handle('sound:clear', async () => {
    clearCustomSound();
    broadcastState();
    return { ok: true };
  });

  ipcMain.handle('sound:preview', async () => {
    const played = await playConfiguredSound();
    if (!played) {
      return {
        ok: false,
        error:
          'No hay MP3 disponible. Agrega un archivo en renderer/assets/sounds/ o sube uno personalizado.',
      };
    }
    return { ok: true };
  });

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    const allowed =
      typeof url === 'string' &&
      (url.startsWith('https://github.com/') || url.startsWith('https://docs.github.com/'));
    if (!allowed) {
      return { ok: false, error: 'URL no permitida' };
    }
    await require('electron').shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('logs:get', async () => logger.getRecent(100));

  ipcMain.handle('update:getState', async () => autoUpdaterService.getState());

  ipcMain.handle('update:check', async () => autoUpdaterService.checkForUpdates());

  ipcMain.handle('update:install', async () => autoUpdaterService.quitAndInstall());

  pushMonitor.onStatus(() => broadcastState());
  logger.onLog((entry) => sendToRenderer('app:log', entry));
  autoUpdaterService.onUpdate((update) => sendToRenderer('app:update', update));
}

module.exports = { registerIpcHandlers, buildState, broadcastState };
