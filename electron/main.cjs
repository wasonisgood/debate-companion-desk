const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const child_process = require('child_process');
const { BridgeServer } = require('./bridgeServer.cjs');

const APP_USER_MODEL_ID = 'com.mootcourt.debatecompanion';
app.setAppUserModelId(APP_USER_MODEL_ID);

// Register custom protocol debate-companion://
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('debate-companion', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('debate-companion');
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let bridgeServer = null;
let isFloating = false;

function getLocalPackageVersion() {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.version || '1.0.0';
  } catch (_) {
    return '1.0.0';
  }
}

function isNewerVersion(remote, local) {
  if (!remote) return false;
  const parse = v => (v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const r = parse(remote);
  const l = parse(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

function fetchJson(urlStr, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(urlStr, { timeout: timeoutMs, headers: { 'User-Agent': 'DebateCompanion-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP status ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function checkRemoteUpdate() {
  const currentVer = getLocalPackageVersion();
  const manifestUrls = [
    'https://raw.githubusercontent.com/wasonisgood/debate-companion-desk/main/installer/publish/latest.json',
    'https://github.com/wasonisgood/debate-companion-desk/releases/latest/download/latest.json'
  ];

  let manifest = null;
  for (const url of manifestUrls) {
    try {
      manifest = await fetchJson(url, 4000);
      if (manifest && manifest.version) break;
    } catch (_) {}
  }

  // Fallback to local manifest if offline or testing
  if (!manifest) {
    const localManifestPath = path.join(__dirname, '../installer/publish/latest.json');
    if (fs.existsSync(localManifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
      } catch (_) {}
    }
  }

  if (!manifest || !manifest.version) {
    return {
      hasUpdate: false,
      currentVersion: currentVer,
      message: '目前已是最新版本或無法連線至更新伺服器。'
    };
  }

  const hasNewer = isNewerVersion(manifest.version, currentVer);
  return {
    hasUpdate: hasNewer,
    currentVersion: currentVer,
    latestVersion: manifest.version,
    mandatory: !!manifest.mandatory,
    minimumVersion: manifest.minimumVersion || '1.0.0',
    notesZh: manifest.notesZh || manifest.notes?.zh || '系統效能優化與辯論對照模組升級。',
    installerUrl: manifest.installerUrl || 'https://github.com/wasonisgood/debate-companion-desk/releases/latest/download/DebateCompanionSetup.exe',
    sha256: manifest.sha256 || ''
  };
}

function handleProtocolUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return;
  try {
    const raw = urlStr.replace(/^debate-companion:\/\/?/, 'http://localhost/');
    const parsed = new URL(raw);
    const token = parsed.searchParams.get('token');
    const userId = parsed.searchParams.get('userId') || parsed.searchParams.get('uid');
    const name = parsed.searchParams.get('name') || '研究員';

    if (token) {
      const session = {
        userId: userId || 'researcher',
        userName: decodeURIComponent(name),
        token,
        authorizedAt: Date.now()
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('admin-auth-granted', session);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  } catch (e) {
    console.error('Error parsing protocol URL:', e);
  }
}

app.on('second-instance', (_event, commandLine) => {
  if (Array.isArray(commandLine)) {
    const url = commandLine.find(arg => typeof arg === 'string' && arg.startsWith('debate-companion:'));
    if (url) {
      handleProtocolUrl(url);
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 420,
    minHeight: 460,
    frame: false, // Frameless window - custom menu & controls conforming to site aesthetic
    backgroundColor: '#F1ECE2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../app.ico')
  });

  // Start HTTP Bridge Server
  bridgeServer = new BridgeServer({
    port: 48231,
    onAuthTokenReceived: (session) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('admin-auth-granted', session);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    getStatus: () => ({
      windowState: isFloating ? 'floating' : 'workspace',
      version: getLocalPackageVersion()
    })
  });
  bridgeServer.start();

  const devUrl = 'http://localhost:5174';
  const prodIndex = path.join(__dirname, '../dist/index.html');

  if (process.env.NODE_ENV === 'development' || !fs.existsSync(prodIndex)) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(prodIndex).catch(() => {});
    });
  } else {
    mainWindow.loadFile(prodIndex);
  }

  // Handle window control IPCs
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.on('window-set-floating', (_event, floating) => {
    isFloating = floating;
    if (!mainWindow) return;

    if (floating) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setSize(380, 260);
      mainWindow.setResizable(true);
    } else {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setSize(1280, 840);
      mainWindow.center();
    }
  });

  // Open external link
  ipcMain.on('open-external-url', (_event, url) => {
    if (url && typeof url === 'string') {
      shell.openExternal(url);
    }
  });

  // Version query
  ipcMain.handle('get-app-version', () => {
    return getLocalPackageVersion();
  });

  // Update check
  ipcMain.handle('check-for-updates', async () => {
    return await checkRemoteUpdate();
  });

  // Download & Install update
  ipcMain.handle('download-and-install-update', async (_event, updateInfo) => {
    try {
      const urlStr = updateInfo?.installerUrl;
      if (!urlStr) throw new Error('未提供有效之安裝程式下載網址。');

      const tempDir = app.getPath('temp');
      const targetExePath = path.join(tempDir, 'DebateCompanionUpdateSetup.exe');

      await new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const mod = u.protocol === 'https:' ? https : http;
        const fileStream = fs.createWriteStream(targetExePath);

        const req = mod.get(urlStr, { headers: { 'User-Agent': 'DebateCompanion-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            mod.get(res.headers.location, (redRes) => {
              const totalBytes = parseInt(redRes.headers['content-length'] || '0', 10);
              let receivedBytes = 0;
              redRes.on('data', chunk => {
                receivedBytes += chunk.length;
                if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('update-download-progress', {
                    percent: Math.min(100, Math.round((receivedBytes / totalBytes) * 100)),
                    transferred: receivedBytes,
                    total: totalBytes
                  });
                }
              });
              redRes.pipe(fileStream);
              fileStream.on('finish', () => fileStream.close(resolve));
            }).on('error', reject);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`下載失敗，HTTP 代碼: ${res.statusCode}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          res.on('data', chunk => {
            receivedBytes += chunk.length;
            if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update-download-progress', {
                percent: Math.min(100, Math.round((receivedBytes / totalBytes) * 100)),
                transferred: receivedBytes,
                total: totalBytes
              });
            }
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(resolve));
        });

        req.on('error', reject);
      });

      // Verify SHA256 if provided
      if (updateInfo.sha256) {
        const buf = fs.readFileSync(targetExePath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
        if (hash !== updateInfo.sha256.toLowerCase()) {
          throw new Error('更新安裝檔 SHA256 驗證不合，檔案可能已損毀。');
        }
      }

      // Execute installer and quit
      child_process.spawn(targetExePath, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => {
        app.quit();
      }, 500);

      return { success: true };
    } catch (e) {
      console.error('Download update error:', e);
      return { success: false, error: e.message };
    }
  });

  // Background auto check after 3.5s
  setTimeout(async () => {
    try {
      const res = await checkRemoteUpdate();
      if (res && res.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', res);
      }
    } catch (_) {}
  }, 3500);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (bridgeServer) bridgeServer.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
