/**
 * System tray integration — keep the app running in the background on Windows.
 */
const path = require('path');
const { Tray, Menu, nativeImage, app } = require('electron');
const { config } = require('../config');
const { getMainWindow } = require('./window');
const logger = require('../services/logger');

let tray = null;

function createTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // 16x16 dark placeholder so Tray still works without a custom asset
    image = nativeImage.createEmpty();
  }
  return image.resize({ width: 16, height: 16 });
}

function createTray({ onQuit, onShow, onToggleMonitor, isMonitoring }) {
  if (tray) return tray;

  tray = new Tray(createTrayIcon());
  tray.setToolTip(config.appName);

  const rebuild = () => {
    const monitoring = typeof isMonitoring === 'function' ? isMonitoring() : false;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Abrir ${config.appName}`,
        click: () => onShow?.(),
      },
      {
        label: monitoring ? 'Detener monitoreo' : 'Iniciar monitoreo',
        click: () => onToggleMonitor?.(),
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => onQuit?.(),
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  rebuild();

  tray.on('double-click', () => onShow?.());
  tray._rebuild = rebuild;

  logger.info('System tray ready');
  return tray;
}

function refreshTrayMenu() {
  tray?._rebuild?.();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function showMainFromTray() {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function wireMinimizeToTray(win, enabledGetter) {
  win.on('close', (event) => {
    if (app.isQuitting) return;
    const enabled = typeof enabledGetter === 'function' ? enabledGetter() : true;
    if (enabled) {
      event.preventDefault();
      win.hide();
      logger.info('Window hidden to tray');
    }
  });
}

module.exports = {
  createTray,
  destroyTray,
  refreshTrayMenu,
  showMainFromTray,
  wireMinimizeToTray,
};
