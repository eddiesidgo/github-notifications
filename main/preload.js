/**
 * Preload bridge — exposes a safe API to the renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitPushNotifier', {
  getState: () => ipcRenderer.invoke('app:getState'),
  login: () => ipcRenderer.invoke('auth:login'),
  loginWithPat: (token) => ipcRenderer.invoke('auth:loginWithPat', token),
  logout: () => ipcRenderer.invoke('auth:logout'),
  addRepo: (fullName) => ipcRenderer.invoke('repos:add', fullName),
  removeRepo: (owner, name) => ipcRenderer.invoke('repos:remove', { owner, name }),
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  pollNow: () => ipcRenderer.invoke('monitor:pollNow'),
  setPollInterval: (ms) => ipcRenderer.invoke('settings:setPollInterval', ms),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('settings:setOpenAtLogin', enabled),
  testNotification: () => ipcRenderer.invoke('notify:test'),
  chooseSound: () => ipcRenderer.invoke('sound:choose'),
  clearSound: () => ipcRenderer.invoke('sound:clear'),
  previewSound: () => ipcRenderer.invoke('sound:preview'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on('app:log', listener);
    return () => ipcRenderer.removeListener('app:log', listener);
  },
  onUpdate: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('app:update', listener);
    return () => ipcRenderer.removeListener('app:update', listener);
  },
});
