const { app, Notification } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

let mainWindowRef = null;
let isDownloading = false;
let downloadedInfo = null;

let updateStatus = {
  status: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
  version: null,
  progress: 0,
  error: null,
};

function getUpdateStatus() {
  return updateStatus;
}

function broadcastStatus() {
  if (mainWindowRef && !mainWindowRef.isDestroyed() && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
    mainWindowRef.webContents.send('auto-update-status', updateStatus);
  }
}

function setStatus(newStatus) {
  updateStatus = { ...updateStatus, ...newStatus };
  broadcastStatus();
}

function isNewerVersion(remote, local) {
  const cleanRemote = (remote || '').replace(/^v/, '').trim();
  const cleanLocal = (local || '').replace(/^v/, '').trim();
  const rParts = cleanRemote.split('.').map((n) => parseInt(n, 10) || 0);
  const lParts = cleanLocal.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

function findUpdateAsset(assets, platform = process.platform, arch = process.arch) {
  if (!Array.isArray(assets)) return null;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      const armZip = assets.find((a) => a.name.includes('arm64') && a.name.endsWith('.zip') && !a.name.endsWith('.blockmap'));
      if (armZip) return armZip;
    }
    const macZip = assets.find((a) => (a.name.includes('mac') || a.name.includes('darwin')) && a.name.endsWith('.zip') && !a.name.endsWith('.blockmap'));
    if (macZip) return macZip;
    return assets.find((a) => a.name.endsWith('.zip') && !a.name.endsWith('.blockmap'));
  } else if (platform === 'win32') {
    const setupExe = assets.find((a) => a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
    if (setupExe) return setupExe;
    return assets.find((a) => a.name.endsWith('.exe') && !a.name.endsWith('.blockmap'));
  }
  return null;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/Kaashviw3spaces/Idler/releases/latest',
      headers: {
        'User-Agent': 'Idler-AutoUpdater',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 12000,
    };

    const req = https.get(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
        return;
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub API request timed out'));
    });

    req.on('error', reject);
  });
}

function downloadFile(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 10) {
        reject(new Error('Too many redirects while downloading update'));
        return;
      }

      const parsed = new URL(currentUrl);
      const req = https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Idler-AutoUpdater',
          'Accept': 'application/octet-stream',
        },
        timeout: 60000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        let lastPercent = -1;
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            if (percent !== lastPercent) {
              lastPercent = percent;
              onProgress(percent, downloadedBytes, totalBytes);
            }
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Update download timed out'));
      });

      req.on('error', reject);
    }

    get(fileUrl);
  });
}

async function startDownload(asset, version) {
  if (isDownloading) return;
  isDownloading = true;

  try {
    setStatus({
      status: 'downloading',
      version,
      progress: 0,
      error: null,
    });

    const tempDir = path.join(os.tmpdir(), 'idler-update');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const downloadPath = path.join(tempDir, asset.name);
    if (fs.existsSync(downloadPath)) {
      fs.unlinkSync(downloadPath);
    }

    await downloadFile(asset.browser_download_url, downloadPath, (progress) => {
      setStatus({
        status: 'downloading',
        version,
        progress,
        error: null,
      });
    });

    // Post-download extraction for macOS
    let readyToInstall = true;
    if (process.platform === 'darwin') {
      const extractDir = path.join(tempDir, 'extracted');
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(extractDir, { recursive: true });

      try {
        execSync(`ditto -xk "${downloadPath}" "${extractDir}"`);
        const extractedApp = path.join(extractDir, 'Idler.app');
        if (!fs.existsSync(extractedApp)) {
          throw new Error('Idler.app not found in update archive');
        }
      } catch (err) {
        console.error('[AutoUpdater Extract Error]:', err);
        readyToInstall = false;
        setStatus({
          status: 'error',
          error: `Extraction failed: ${err.message}`,
        });
      }
    }

    if (readyToInstall) {
      downloadedInfo = {
        version,
        assetName: asset.name,
        filePath: downloadPath,
      };

      setStatus({
        status: 'downloaded',
        version,
        progress: 100,
        error: null,
      });

      if (Notification.isSupported()) {
        new Notification({
          title: '🦥 Idler Update Ready!',
          body: `v${version} is ready. Restart Idler to apply.`,
        }).show();
      }
    }
  } catch (err) {
    console.error('[AutoUpdater Download Error]:', err);
    setStatus({
      status: 'error',
      version: null,
      progress: 0,
      error: err.message,
    });
  } finally {
    isDownloading = false;
  }
}

async function checkForUpdates() {
  if (isDownloading) {
    return { success: true, message: 'Download already in progress' };
  }

  setStatus({ status: 'checking', error: null });

  try {
    const release = await fetchLatestRelease();
    const remoteVersion = (release.tag_name || '').replace(/^v/, '').trim();
    const currentVersion = app.getVersion();

    console.log(`[AutoUpdater]: Current v${currentVersion}, Latest Remote v${remoteVersion}`);

    if (isNewerVersion(remoteVersion, currentVersion)) {
      const asset = findUpdateAsset(release.assets);
      if (!asset) {
        console.warn(`[AutoUpdater]: No compatible update asset found for ${process.platform}-${process.arch}`);
        setStatus({
          status: 'error',
          error: `No compatible asset found for ${process.platform}`,
        });
        return { success: false, error: 'No compatible package found' };
      }

      console.log(`[AutoUpdater]: Found update v${remoteVersion} (${asset.name}). Starting background download...`);
      setStatus({
        status: 'available',
        version: remoteVersion,
        progress: 0,
        error: null,
      });

      if (Notification.isSupported()) {
        new Notification({
          title: '🦥 Idler Update Available',
          body: `Version v${remoteVersion} is downloading in the background...`,
        }).show();
      }

      // Automatically download in background
      startDownload(asset, remoteVersion);
      return { success: true, updateAvailable: true, version: remoteVersion };
    } else {
      console.log('[AutoUpdater]: Idler is up to date.');
      setStatus({
        status: 'not-available',
        version: currentVersion,
        progress: 0,
        error: null,
      });
      return { success: true, updateAvailable: false, version: currentVersion };
    }
  } catch (err) {
    console.warn('[AutoUpdater Check Warning]:', err.message);
    setStatus({
      status: 'error',
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

function quitAndInstallUpdate(cleanupBackend) {
  if (updateStatus.status !== 'downloaded' || !downloadedInfo) {
    console.warn('[AutoUpdater]: Cannot install — update is not downloaded');
    return false;
  }

  const tempDir = path.join(os.tmpdir(), 'idler-update');

  if (cleanupBackend && typeof cleanupBackend === 'function') {
    try { cleanupBackend(); } catch {}
  }

  if (process.platform === 'darwin') {
    const currentExe = process.execPath;
    const appBundle = currentExe.includes('.app')
      ? currentExe.replace(/\/Contents\/MacOS\/[^/]+$/, '')
      : '/Applications/Idler.app';
    const extractedApp = path.join(tempDir, 'extracted', 'Idler.app');

    if (!fs.existsSync(extractedApp)) {
      console.error('[AutoUpdater]: Extracted app bundle missing at', extractedApp);
      return false;
    }

    const scriptPath = path.join(tempDir, 'apply-update.sh');
    const script = `#!/bin/bash
sleep 1.2
if [ -d "${extractedApp}" ]; then
  rm -rf "${appBundle}"
  cp -R "${extractedApp}" "${appBundle}"
  xattr -cr "${appBundle}"
  open -a "${appBundle}"
fi
`;
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });

    console.log('[AutoUpdater]: Launching macOS updater script and quitting...');
    const child = spawn('/bin/bash', [scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    app.isQuitting = true;
    app.exit(0);
    return true;
  } else if (process.platform === 'win32') {
    const installerPath = downloadedInfo.filePath;
    if (!fs.existsSync(installerPath)) {
      console.error('[AutoUpdater]: Installer missing at', installerPath);
      return false;
    }

    console.log('[AutoUpdater]: Launching Windows silent installer and quitting...');
    const child = spawn(installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    app.isQuitting = true;
    app.exit(0);
    return true;
  }

  return false;
}

function initAutoUpdater(mainWindow, getBackendProcess) {
  mainWindowRef = mainWindow;

  // Initial check after 5 seconds
  setTimeout(() => {
    checkForUpdates().catch((err) => {
      console.log('[AutoUpdater Startup Check]:', err.message);
    });
  }, 5000);

  // Periodic check every 30 minutes
  setInterval(() => {
    checkForUpdates().catch((err) => {
      console.log('[AutoUpdater Periodic Check]:', err.message);
    });
  }, 30 * 60 * 1000);
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstallUpdate,
  getUpdateStatus,
};

