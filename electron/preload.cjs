const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('idlerDesktop', {
  isElectron: true,
  platform: process.platform,
  playNativeChime: (style) => ipcRenderer.invoke('play-chime', style),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  openStudio: () => ipcRenderer.invoke('open-studio'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  resizeHeight: (height) => ipcRenderer.send('resize-height', height),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('quit-and-install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  onAutoUpdateStatus: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('auto-update-status', handler);
    return () => ipcRenderer.removeListener('auto-update-status', handler);
  },
  onWindowShown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('window-shown', handler);
    return () => ipcRenderer.removeListener('window-shown', handler);
  },
});

