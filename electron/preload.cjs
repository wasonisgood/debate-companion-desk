const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  setFloatingWindow: (floating) => ipcRenderer.send('window-set-floating', floating),
  onAuthGranted: (callback) => {
    ipcRenderer.on('admin-auth-granted', (_event, session) => callback(session));
  },
  getPlatformInfo: () => ({
    platform: process.platform,
    arch: process.arch
  })
});
