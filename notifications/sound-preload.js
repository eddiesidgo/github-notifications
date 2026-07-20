const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationSound', {
  onPlay: (handler) => {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('sound:play', listener);
    return () => ipcRenderer.removeListener('sound:play', listener);
  },
});
