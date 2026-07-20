/**
 * Native Windows notifications via Electron Notification API,
 * plus default / custom MP3 playback.
 *
 * Default sound (shipped with the app):
 *   renderer/assets/sounds/levelup_sVAqjan.mp3
 *
 * User override (chosen from the UI):
 *   copied into Electron userData/sounds/custom-notification.mp3
 */
const { Notification, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('../services/logger');
const storage = require('../storage/store');
const { playSoundFile } = require('./soundPlayer');

const MAX_SOUND_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_SOUND_FILENAME = 'levelup_sVAqjan.mp3';

function getIcon() {
  const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
  try {
    return nativeImage.createFromPath(iconPath);
  } catch {
    return undefined;
  }
}

/** Bundled default MP3 — drop your file here in the project. */
function getDefaultSoundPath() {
  return path.join(__dirname, '..', 'renderer', 'assets', 'sounds', DEFAULT_SOUND_FILENAME);
}

function getSoundsDir() {
  const dir = path.join(app.getPath('userData'), 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStoredSoundPath() {
  const settings = storage.getSettings();
  const stored = settings.customSoundPath;
  if (stored && fs.existsSync(stored)) return stored;
  return null;
}

/**
 * Active sound for notifications:
 * 1) user custom MP3, else 2) bundled default, else 3) null (Windows system tone).
 */
function resolveActiveSound() {
  const custom = getStoredSoundPath();
  if (custom) {
    return {
      path: custom,
      source: 'custom',
      name: storage.getSettings().customSoundName || path.basename(custom),
    };
  }

  const defaultPath = getDefaultSoundPath();
  if (fs.existsSync(defaultPath)) {
    return {
      path: defaultPath,
      source: 'default',
      name: DEFAULT_SOUND_FILENAME,
    };
  }

  return { path: null, source: 'system', name: null };
}

/**
 * Copy a user-selected MP3 into app userData and persist the path.
 * @param {string} sourcePath
 */
function installCustomSound(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const err = new Error('Archivo no encontrado.');
    err.code = 'SOUND_NOT_FOUND';
    throw err;
  }

  const ext = path.extname(sourcePath).toLowerCase();
  if (ext !== '.mp3') {
    const err = new Error('Solo se permiten archivos .mp3');
    err.code = 'SOUND_INVALID_TYPE';
    throw err;
  }

  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_SOUND_BYTES) {
    const err = new Error('El MP3 supera el límite de 5 MB.');
    err.code = 'SOUND_TOO_LARGE';
    throw err;
  }

  const originalName = path.basename(sourcePath);
  const dest = path.join(getSoundsDir(), 'custom-notification.mp3');
  fs.copyFileSync(sourcePath, dest);

  storage.setSettings({
    customSoundPath: dest,
    customSoundName: originalName,
  });

  logger.info('Custom notification sound installed', { originalName });
  return {
    path: dest,
    name: originalName,
  };
}

function clearCustomSound() {
  const current = getStoredSoundPath();
  if (current) {
    try {
      fs.unlinkSync(current);
    } catch {
      // ignore
    }
  }
  storage.setSettings({
    customSoundPath: null,
    customSoundName: null,
  });
  logger.info('Custom notification sound cleared (back to default/system)');
}

function getSoundInfo() {
  const active = resolveActiveSound();
  return {
    hasCustomSound: active.source === 'custom',
    hasDefaultSound: fs.existsSync(getDefaultSoundPath()),
    soundSource: active.source,
    customSoundName: active.source === 'custom' ? active.name : null,
    activeSoundName: active.name,
  };
}

async function playConfiguredSound() {
  const active = resolveActiveSound();
  if (!active.path) return false;
  return playSoundFile(active.path);
}

/**
 * @param {{ repo: string, branch: string, author: string, message: string, url?: string }} payload
 */
async function notifyPush(payload) {
  if (!Notification.isSupported()) {
    logger.warn('Native notifications are not supported on this system');
    return false;
  }

  const active = resolveActiveSound();
  const useAppSound = Boolean(active.path);

  const title = `Push en ${payload.repo}`;
  const body = [
    `Branch: ${payload.branch}`,
    `Autor: ${payload.author}`,
    payload.message ? `Commit: ${payload.message}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const notification = new Notification({
    title,
    body,
    // Mute OS tone when we play an app MP3 (default or custom)
    silent: useAppSound,
    icon: getIcon(),
  });

  if (payload.url) {
    notification.on('click', () => {
      const { shell } = require('electron');
      shell.openExternal(payload.url);
    });
  }

  notification.show();

  if (useAppSound) {
    await playSoundFile(active.path);
  }

  logger.info('Notification shown', {
    repo: payload.repo,
    branch: payload.branch,
    soundSource: active.source,
  });
  return true;
}

/** Local smoke-test from the UI */
async function notifyTest() {
  return notifyPush({
    repo: 'demo/repo',
    branch: 'main',
    author: 'GitPushNotifier',
    message: 'Notificación de prueba local',
  });
}

module.exports = {
  notifyPush,
  notifyTest,
  installCustomSound,
  clearCustomSound,
  getSoundInfo,
  playConfiguredSound,
  getDefaultSoundPath,
  MAX_SOUND_BYTES,
};
