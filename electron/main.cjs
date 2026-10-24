// Ensure Electron does not inherit node CLI mode from parent shell
delete process.env.ELECTRON_RUN_AS_NODE;

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

let tray = null;
let mainWindow = null;
let backendProcess = null;
let isDialogOpen = false;

const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT = 610;

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
  const fs = require('fs');
  const colorTrayPath = path.join(__dirname, 'assets', 'tray@2x.png');
  const templatePath = path.join(__dirname, 'assets', 'trayTemplate.png');

  if (fs.existsSync(colorTrayPath)) {
    const icon = nativeImage.createFromPath(colorTrayPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 22, height: 22 });
    }
  }

  let icon = nativeImage.createFromPath(templatePath);
  if (icon.isEmpty()) {
    const fallbackDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAMElEQVR42mNkIAAYCQlYqGkeNYx6ZEAOGhgYGBghfAawGkYNY9SM0YyG6gEMDAAAK1gCBd3P+GMAAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL(fallbackDataUri);
  }
  return icon.resize({ width: 22, height: 22 });
}

function getWindowPosition() {
  if (!mainWindow) return { x: 0, y: 0 };
  const windowBounds = mainWindow.getBounds();

  let targetDisplay = screen.getPrimaryDisplay();
  let trayBounds = null;

  if (tray) {
    try {
      trayBounds = tray.getBounds();
      if (trayBounds && (trayBounds.x > 0 || trayBounds.y > 0)) {
        targetDisplay = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }) || targetDisplay;
      }
    } catch {
      // Fallback
    }
  }

  if (!trayBounds || (trayBounds.x === 0 && trayBounds.y === 0)) {
    const cursor = screen.getCursorScreenPoint();
    targetDisplay = screen.getDisplayNearestPoint(cursor) || targetDisplay;
  }

  const { x: displayX, y: displayY, width: screenWidth, height: screenHeight } = targetDisplay.workArea;

  let x = 0;
  let y = 0;

  if (trayBounds && (trayBounds.x > 0 || trayBounds.y > 0)) {
    x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    y = Math.round(trayBounds.y + trayBounds.height + 4);
  } else {
    x = displayX + screenWidth - windowBounds.width - 20;
    y = displayY + 30;
  }

  // Ensure window stays within visible display work area
  if (x < displayX + 10) x = displayX + 10;
  if (x + windowBounds.width > displayX + screenWidth - 10) {
    x = displayX + screenWidth - windowBounds.width - 10;
  }
  if (y < displayY + 5) y = displayY + 5;
  if (y + windowBounds.height > displayY + screenHeight - 10) {
    y = displayY + screenHeight - windowBounds.height - 10;
  }

  return { x, y };
}

let lastWindowShowTime = 0;

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  const { x, y } = getWindowPosition();
  mainWindow.setPosition(x, y, false);
  lastWindowShowTime = Date.now();
  // Ensure window floats over current space/desktop (Chrome, VS Code, etc.) without switching Spaces
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'status', 1);
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('window-shown');
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
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    resizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Enable floating across all macOS spaces/virtual desktops & over fullscreen apps like Chrome
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'status', 1);

  mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('Renderer failed to load:', code, desc, url);
  });

  mainWindow.webContents.on('console-message', (e, level, message) => {
    console.log(`[Renderer]:`, message);
  });

  const bundledUiPath = path.join(__dirname, 'frontend_dist', 'index.html');

  if (app.isPackaged) {
    mainWindow.loadFile(bundledUiPath);
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile(bundledUiPath);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    showWindow();
  });

  // Auto-hide when user clicks outside the popover window (with a grace window on launch)
  mainWindow.on('blur', () => {
    if (isDialogOpen) return;
    if (Date.now() - lastWindowShowTime < 1500) {
      return;
    }
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide();
    }
  });

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

ipcMain.handle('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle('open-studio', () => {
  shell.openExternal('http://localhost:5173');
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  isDialogOpen = true;
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Active Folder to Scan on Computer',
      buttonLabel: 'Select Folder',
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } finally {
    isDialogOpen = false;
    lastWindowShowTime = Date.now();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
});

ipcMain.on('resize-height', (event, height) => {
  if (!mainWindow) return;
  const clampedHeight = Math.max(280, Math.min(Math.round(height), 780));
  const currentBounds = mainWindow.getBounds();
  if (Math.abs(currentBounds.height - clampedHeight) > 3) {
    mainWindow.setBounds({
      x: currentBounds.x,
      y: currentBounds.y,
      width: POPOVER_WIDTH,
      height: clampedHeight,
    }, true);
  }
});

// App Lifecycle
app.whenReady().then(() => {
  if (app.dock) {
    app.dock.hide();
  }
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
