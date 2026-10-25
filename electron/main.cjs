// Ensure Electron does not inherit node CLI mode from parent shell
delete process.env.ELECTRON_RUN_AS_NODE;

// Global process exception handlers to prevent native Electron JS Error dialogs
process.on('uncaughtException', (err) => {
  console.error('[Main Process Uncaught Exception]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main Process Unhandled Rejection]:', reason);
});

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

let autoUpdater = null;
try {
  const updaterModule = require('electron-updater');
  autoUpdater = updaterModule.autoUpdater;
} catch (e) {
  console.warn('electron-updater not loaded:', e.message);
}

let tray = null;
let mainWindow = null;
let backendProcess = null;
let isDialogOpen = false;
let isPinned = false;

let updateStatus = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
  version: null,
  progress: 0,
  error: null,
};

function broadcastUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('auto-update-status', updateStatus);
  }
}

function initAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater]: Checking for update...');
    updateStatus = { status: 'checking', version: null, progress: 0, error: null };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater]: Update available:', info.version);
    updateStatus = { status: 'available', version: info.version, progress: 0, error: null };
    broadcastUpdateStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: '🦥 Idler Update Available',
        body: `Version v${info.version} is downloading in the background...`,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater]: Idler is up to date.');
    updateStatus = { status: 'not-available', version: info?.version || app.getVersion(), progress: 0, error: null };
    broadcastUpdateStatus();
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater Warning]:', err ? err.message : 'Unknown error');
    updateStatus = { status: 'error', version: null, progress: 0, error: err ? err.message : 'Update check failed' };
    broadcastUpdateStatus();
  });

  autoUpdater.on('download-progress', (progressObj) => {
    updateStatus = {
      status: 'downloading',
      version: updateStatus.version,
      progress: Math.round(progressObj.percent || 0),
      error: null,
    };
    broadcastUpdateStatus();
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater]: Update downloaded:', info.version);
    updateStatus = { status: 'downloaded', version: info.version, progress: 100, error: null };
    broadcastUpdateStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: '🦥 Idler Update Ready!',
        body: `v${info.version} is ready. Restart Idler to apply.`,
      }).show();
    }
  });
}

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
  const templatePath1x = path.join(__dirname, 'assets', 'trayTemplate.png');
  const templatePath2x = path.join(__dirname, 'assets', 'trayTemplate@2x.png');
  const whiteTrayPath = path.join(__dirname, 'assets', 'tray@2x.png');

  let icon = null;
  if (fs.existsSync(templatePath1x)) {
    icon = nativeImage.createFromPath(templatePath1x);
  } else if (fs.existsSync(templatePath2x)) {
    icon = nativeImage.createFromPath(templatePath2x);
  } else if (fs.existsSync(whiteTrayPath)) {
    icon = nativeImage.createFromPath(whiteTrayPath);
  }

  if (!icon || icon.isEmpty()) {
    const fallbackDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAMElEQVR42mNkIAAYCQlYqGkeNYx6ZEAOGhgYGBghfAawGkYNY9SM0YyG6gEMDAAAK1gCBd3P+GMAAAAASUVORK5CYII=';
    icon = nativeImage.createFromDataURL(fallbackDataUri);
  }

  const resized = icon.resize({ width: 20, height: 20 });
  if (process.platform === 'darwin') {
    resized.setTemplateImage(true);
  }
  return resized;
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
  const level = isPinned ? 'screen-saver' : 'status';
  mainWindow.setAlwaysOnTop(true, level, 1);
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

function setPinned(pinned) {
  isPinned = !!pinned;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const level = isPinned ? 'screen-saver' : 'status';
    mainWindow.setAlwaysOnTop(true, level, 1);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (isPinned && !mainWindow.isVisible()) {
      showWindow();
    }
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('pin-status-changed', isPinned);
    }
  }
  updateTrayMenu();
  return isPinned;
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
    hiddenInMissionControl: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Enable floating across all macOS spaces/virtual desktops & over fullscreen apps like Chrome
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const level = isPinned ? 'screen-saver' : 'status';
  mainWindow.setAlwaysOnTop(true, level, 1);

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
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.loadFile(bundledUiPath);
        }
      } catch {}
    });
  }

  mainWindow.once('ready-to-show', () => {
    showWindow();
  });

  // Auto-hide when user clicks outside the popover window (unless pinned in Screen Record Mode)
  mainWindow.on('blur', () => {
    if (isPinned) return; // Keep window open during screen recording or pinning
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

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: '🦥 Idler Desktop', enabled: false },
    { type: 'separator' },
    {
      label: 'Open Idler Window',
      click: () => showWindow(),
    },
    {
      label: isPinned ? '📌 Keep Window Open (Screen Record Mode)  ✓' : '📌 Keep Window Open (Screen Record Mode)',
      type: 'checkbox',
      checked: isPinned,
      click: (menuItem) => {
        setPinned(menuItem.checked);
      },
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
      label: 'Check for Updates...',
      click: () => {
        if (autoUpdater) {
          autoUpdater.checkForUpdatesAndNotify().catch((err) => {
            console.warn('[AutoUpdater]:', err.message);
          });
        }
      },
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

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Idler — Local AI File Assistant');
  if (process.platform === 'darwin') {
    tray.setIgnoreDoubleClickEvents(true);
  }
  updateTrayMenu();

  // Click tray icon to toggle window
  tray.on('click', () => {
    toggleWindow();
  });

  // Right-click opens context menu
  tray.on('right-click', () => {
    updateTrayMenu();
    tray.popUpContextMenu();
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
    console.log('Starting Idler Core backend server...');
    const exeName = process.platform === 'win32' ? 'idler-core.exe' : 'idler-core';
    const isWin = process.platform === 'win32';
    const pyVenvRel = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');

    let backendBin = '';
    let spawnArgs = [];
    let workDir = undefined;

    if (app.isPackaged) {
      const packagedCore = path.join(process.resourcesPath, 'backend', exeName);
      if (require('fs').existsSync(packagedCore)) {
        backendBin = packagedCore;
        spawnArgs = ['--host', '127.0.0.1', '--port', '8000'];
        workDir = path.dirname(packagedCore);
      }
    }

    if (!backendBin) {
      const candidates = [
        path.join(__dirname, '..', 'backend', 'dist', 'idler-core', exeName),
        path.join(process.resourcesPath || '', 'backend', exeName),
        path.join(__dirname, '..', 'backend', 'venv', pyVenvRel),
      ];
      for (const c of candidates) {
        if (require('fs').existsSync(c)) {
          backendBin = c;
          if (c.endsWith(exeName)) {
            spawnArgs = ['--host', '127.0.0.1', '--port', '8000'];
            workDir = path.dirname(c);
          } else {
            spawnArgs = ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'];
            workDir = path.resolve(path.dirname(c), '..', '..');
          }
          break;
        }
      }
    }

    if (!backendBin) {
      backendBin = isWin ? 'python' : 'python3';
      spawnArgs = ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000'];
    }

    try {
      backendProcess = spawn(backendBin, spawnArgs, {
        cwd: (workDir && require('fs').existsSync(workDir)) ? workDir : undefined,
        stdio: 'ignore',
        windowsHide: true,
      });

      // CRITICAL: Prevent the "JS error" pop-up if spawn fails
      backendProcess.on('error', (err) => {
        console.error('Backend process failed to spawn:', err);
      });

      backendProcess.on('exit', (code, signal) => {
        console.log(`Backend process exited with code ${code}, signal ${signal}`);
        backendProcess = null;
      });
    } catch (err) {
      console.error('Failed to launch backend process safely:', err);
    }
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

ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { success: false, error: 'Auto-updater not initialized' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('quit-and-install-update', () => {
  if (!autoUpdater) return false;
  app.isQuitting = true;
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-update-status', () => {
  return updateStatus;
});

ipcMain.handle('set-pinned', (e, pinned) => {
  return setPinned(pinned);
});

ipcMain.handle('get-pinned', () => {
  return isPinned;
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
  initAutoUpdater();

  // Auto-check for updates after 6 seconds in packaged mode
  setTimeout(() => {
    if (autoUpdater && app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.log('[AutoUpdater Startup Check]:', err?.message);
      });
    }
  }, 6000);
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
