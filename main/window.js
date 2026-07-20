/**
 * BrowserWindow factory for the renderer UI.
 */
const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');
const { config } = require('../config');

let mainWindow = null;

function getAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
  ];
  for (const iconPath of candidates) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) return iconPath;
  }
  return undefined;
}

/**
 * @param {{ startHidden?: boolean }} [options]
 */
function createMainWindow(options = {}) {
  const iconPath = getAppIconPath();
  const startHidden = Boolean(options.startHidden);

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: config.appName,
    icon: iconPath,
    show: false,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Windows taskbar sometimes ignores constructor icon — re-apply explicitly
  if (iconPath && process.platform === 'win32') {
    mainWindow.setIcon(iconPath);
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    // Startup launches stay in the tray until the user opens the app
    if (startHidden) return;
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

module.exports = { createMainWindow, getMainWindow, sendToRenderer };
