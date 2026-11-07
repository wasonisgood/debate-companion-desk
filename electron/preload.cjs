const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  setFloatingWindow: (floating) => ipcRenderer.send('window-set-floating', floating),
  openExternal: (url) => ipcRenderer.send('open-external-url', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadAndInstallUpdate: (updateInfo) => ipcRenderer.invoke('download-and-install-update', updateInfo),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, updateInfo) => callback(updateInfo));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress));
  },
  onAuthGranted: (callback) => {
    ipcRenderer.on('admin-auth-granted', (_event, session) => callback(session));
  },
  getPlatformInfo: () => ({
    platform: process.platform,
    arch: process.arch
  })
});
