// Ensure Electron does not inherit node CLI mode from parent shell
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

let tray = null;
let mainWindow = null;
let backendProcess = null;

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 760;

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

function getTrayIcon() {
  const templatePath = path.join(__dirname, 'assets', 'trayTemplate.png');
  let icon = nativeImage.createFromPath(templatePath);
  if (icon.isEmpty()) {
    // 16x16 fallback data URI
    const fallbackDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAMElEQVR42mNkIAAYCQlYqGkeNYx6ZEAOGhgYGBghfAawGkYNY9SM0YyG6gEMDAAAK1gCBd3P+GMAAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL(fallbackDataUri);
  }
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  return icon;
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();

  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
  }
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 640,
    minHeight: 480,
    show: false,
    center: true,
    title: 'Idler',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const devUrl = 'http://localhost:5173';
  const prodPath = path.join(__dirname, 'frontend_dist', 'index.html');
  const fallbackProdPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');

  function loadStaticUI() {
    const fs = require('fs');
    if (fs.existsSync(prodPath)) {
      mainWindow.loadFile(prodPath);
    } else if (fs.existsSync(fallbackProdPath)) {
      mainWindow.loadFile(fallbackProdPath);
    } else {
      console.error('Frontend build artifacts not found at', prodPath, 'or', fallbackProdPath);
    }
  }

  // Check if Vite dev server is running, otherwise load static production build
  const req = http.get(devUrl, (res) => {
    if (res.statusCode === 200) {
      mainWindow.loadURL(devUrl);
    } else {
      loadStaticUI();
    }
  });
  req.on('error', () => {
    loadStaticUI();
  });
  req.setTimeout(800, () => {
    req.destroy();
    loadStaticUI();
  });

  // Reveal window as soon as rendered
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show();
    }
  });

  // Safety fallback: ensure window is visible after 1.2s regardless of event timing
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show();
      }
    }
  }, 1200);

  // When user clicks the red X close button, hide to tray instead of terminating
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Idler — Local AI File Assistant');

  if (process.platform === 'darwin') {
    tray.setTitle(' Idler');
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: '🦥 Idler Desktop', enabled: false },
    { type: 'separator' },
    {
      label: 'Open Idler Window',
      click: () => showWindow(),
    },
    {
      label: 'Open in Web Browser',
      click: () => shell.openExternal('http://localhost:5173'),
    },
    { type: 'separator' },
    {
      label: 'Play macOS Glass Chime',
      click: () => playNativeChime('mac'),
    },
    {
      label: 'Play Windows Notify Chime',
      click: () => playNativeChime('win'),
    },
    { type: 'separator' },
    {
      label: 'Quit Idler',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  // Click tray icon to toggle window
  tray.on('click', () => {
    toggleWindow();
  });

  // Right-click opens context menu
  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}

function playNativeChime(target) {
  const style = target || (process.platform === 'darwin' ? 'mac' : 'win');

  if (style === 'mac') {
    exec('afplay /System/Library/Sounds/Glass.aiff || afplay /System/Library/Sounds/Hero.aiff');
  } else {
    exec('powershell.exe -NoProfile -Command "[System.Media.SystemSounds]::Asterisk.Play()"');
  }
}

function ensureBackend() {
  http.get('http://127.0.0.1:8000/api/health', (res) => {
    if (res.statusCode === 200) {
      console.log('FastAPI backend is active.');
    }
  }).on('error', () => {
    console.log('Starting FastAPI backend server...');
    const pythonBin = path.join(__dirname, '..', 'backend', 'venv', 'bin', 'python');
    backendProcess = spawn(pythonBin, ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
    });
  });
}

// IPC Handlers
ipcMain.handle('play-chime', (e, style) => {
  playNativeChime(style);
  return { success: true };
});

ipcMain.handle('show-notification', (e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'Idler', body: body || '' }).show();
  }
  return { success: true };
});

ipcMain.handle('toggle-window', () => {
  toggleWindow();
});

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('open-external', (e, url) => {
  if (url) shell.openExternal(url);
});

// App Lifecycle
app.whenReady().then(() => {
  ensureBackend();
  createWindow();
  createTray();
});

app.on('activate', () => {
  showWindow();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep alive in system tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
});
