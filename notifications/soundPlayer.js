/**
 * Plays a local audio file (e.g. custom notification MP3) via a hidden BrowserWindow.
 * Windows toast notifications do not support custom MP3 sounds reliably, so we
 * mute the native toast when a custom file is configured and play it ourselves.
 */
const path = require('path');
const fs = require('fs');
const { BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');
const logger = require('../services/logger');

let playerWindow = null;
let readyPromise = null;

function createPlayerWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 0,
    height: 0,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'sound-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('closed', () => {
    playerWindow = null;
    readyPromise = null;
  });

  return win;
}

async function ensurePlayerReady() {
  if (playerWindow && !playerWindow.isDestroyed() && readyPromise) {
    await readyPromise;
    return playerWindow;
  }

  playerWindow = createPlayerWindow();
  readyPromise = playerWindow
    .loadFile(path.join(__dirname, 'sound-player.html'))
    .then(() => playerWindow);

  await readyPromise;
  return playerWindow;
}

/**
 * @param {string} absolutePath
 * @returns {Promise<boolean>}
 */
async function playSoundFile(absolutePath) {
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    logger.warn('Custom sound file missing', { absolutePath });
    return false;
  }

  try {
    const win = await ensurePlayerReady();
    const url = pathToFileURL(absolutePath).href;
    win.webContents.send('sound:play', url);
    logger.info('Playing custom notification sound', { file: path.basename(absolutePath) });
    return true;
  } catch (err) {
    logger.error('Failed to play custom sound', { message: err.message });
    return false;
  }
}

function destroySoundPlayer() {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.destroy();
  }
  playerWindow = null;
  readyPromise = null;
}

module.exports = { playSoundFile, destroySoundPlayer };
