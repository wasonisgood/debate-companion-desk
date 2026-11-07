const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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
    minHeight: 520,
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
        mainWindow.focus();
      }
    },
    getStatus: () => ({
      windowState: isFloating ? 'floating' : 'workspace'
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
      mainWindow.setSize(440, 600);
      mainWindow.setResizable(true);
    } else {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setSize(1280, 840);
      mainWindow.center();
    }
  });
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
