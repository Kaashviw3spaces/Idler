const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

let tray = null;
let window = null;
let backendProcess = null;

const WINDOW_WIDTH = 500;
const WINDOW_HEIGHT = 750;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.svg');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // Fallback: 16x16 minimal PNG data URI
    const fallbackDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVQ4T2NkoBAwUqifgWoG/P//n5GBgYGBkZERI/7//39GBgYGhh8/fjCiq8GlGW7Av3//MBzAgAcMDDw+fvyIoxlcmiEL0A0g1gBcmohyALFhNFI1kGIEALj/EB7V4qXnAAAAAElFTkSuQmCC';
    icon = nativeImage.createFromDataURL(fallbackDataUri);
  }

  // On macOS, resize to 18x18 and set as template image for Dark/Light mode support
  if (process.platform === 'darwin') {
    const resized = icon.resize({ width: 18, height: 18 });
    resized.setTemplateImage(true);
    return resized;
  }
  return icon.resize({ width: 22, height: 22 });
}

function getWindowPosition() {
  if (!tray) return { x: 0, y: 0 };
  const windowBounds = window.getBounds();
  const trayBounds = tray.getBounds();

  if (process.platform === 'darwin') {
    // macOS: Centered beneath the top menu bar icon
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    return { x, y };
  } else {
    // Windows / Linux: Bottom-right system tray anchor
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y - windowBounds.height - 4);
    return { x, y };
  }
}

function toggleWindow() {
  if (!window) return;
  if (window.isVisible()) {
    window.hide();
  } else {
    showWindow();
  }
}

function showWindow() {
  if (!window) return;
  const { x, y } = getWindowPosition();
  window.setPosition(x, y, false);
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: true,
    fullscreenable: false,
    alwaysOnTop: false,
    skipTaskbar: process.platform === 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load Vite dev server if running, else load built frontend
  const devUrl = 'http://localhost:5173';
  const prodPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');

  http.get(devUrl, () => {
    window.loadURL(devUrl);
  }).on('error', () => {
    window.loadFile(prodPath);
  });

  // Hide window when user clicks outside / blurs
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  window.on('closed', () => {
    window = null;
  });
}

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Idler — Local AI File Assistant');

  const contextMenu = Menu.buildFromTemplate([
    { label: '🦥 Idler (Menu Bar App)', enabled: false },
    { type: 'separator' },
    { label: 'Open Window', click: () => showWindow() },
    { label: 'Open in Browser', click: () => shell.openExternal('http://localhost:5173') },
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

  // Left click toggles window
  tray.on('click', () => {
    toggleWindow();
  });

  // Right click opens context menu
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

// Check backend health, start backend if not running
function ensureBackend() {
  http.get('http://127.0.0.1:8000/api/health', (res) => {
    if (res.statusCode === 200) {
      console.log('FastAPI backend is already active.');
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
  if (window) window.hide();
});

ipcMain.handle('open-external', (e, url) => {
  if (url) shell.openExternal(url);
});

// App Lifecycle
app.whenReady().then(() => {
  ensureBackend();
  createWindow();
  createTray();

  // Hide dock icon on macOS so it runs purely in menu bar
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
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
