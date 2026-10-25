# 🦥 Idler v0.2.1 — Out-of-the-Box Local AI Butler with Auto-Updates 🚀
> *Built for Hacktoberweek 2026 — Clean your digital chaos with 100% private, zero-dependency, non-destructive Local AI.*

---

## 💡 What's New in v0.2.1

### 🚀 1. Zero-Dependency Standalone Core (PyInstaller)
- **Runs Everywhere Immediately**: The core FastAPI backend is compiled into a native standalone binary (`idler-core.exe` on Windows, `idler-core` on macOS) bundled directly inside the application.
- **No Python or Pip Required**: The end user does not need to install Python, virtual environments, or any external dependencies. Just download and run!

### 🔄 2. Seamless Background Auto-Updates
- **Automatic Background Checks**: Idler automatically checks GitHub Releases on startup and downloads new versions silently.
- **Differential Updates**: Windows and macOS auto-update manifests (`latest.yml`, `latest-mac.yml`) enable differential, fast updates.
- **In-App & Tray Controls**:
  - Right-click tray menu now features *"Check for Updates..."*.
  - In-app notification banner alerts you when an update is downloaded: *"🚀 v0.2.1 Update Ready — [Restart Now]"*.
  - Clicking Restart immediately quits and applies the new update.

### 🛡️ 3. Resilient Error Handling & Safe Fallback
- **No More JS Error Pop-ups**: Electron main process includes uncaught exception and spawn error guards, ensuring no native error dialogs pop up.
- **Offline Health Banner**: If the local core is ever initializing or rebooting, the UI gracefully renders a friendly status banner with a single-click *"Retry Connection"* button instead of freezing.

---

## 📦 Downloads & Installation

### 🪟 Windows (10 / 11 64-bit)
| Package | File | Description |
|---|---|---|
| **Installer (Recommended)** | [📥 **`Idler.Setup.0.2.1.exe`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.1/Idler.Setup.0.2.1.exe) | One-click setup installer with Start Menu & System Tray shortcuts |
| **Portable Executable** | [📥 **`Idler.0.2.1.exe`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.1/Idler.0.2.1.exe) | Single-file portable executable. Run immediately without installation |
| **Portable ZIP** | [📥 **`Idler-0.2.1-win.zip`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.1/Idler-0.2.1-win.zip) | Standalone unpacked folder archive |

**Windows Quickstart:**
1. Download **`Idler.Setup.0.2.1.exe`** (or **`Idler.0.2.1.exe`**).
2. Run the application. Idler will appear immediately in your bottom-right **Windows System Tray** (next to the clock).
3. Click the sloth tray icon to open the cozy popover menu, sort files, and preview items!
4. *(Optional)* Windows SmartScreen prompt: Click *"More info"* ➔ *"Run anyway"* (common for freshly published open-source releases).

---

### 🍏 macOS (Apple Silicon / arm64)
| Package | File | Description |
|---|---|---|
| **DMG Installer (Recommended)** | [📥 **`Idler-0.2.1-arm64.dmg`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.1/Idler-0.2.1-arm64.dmg) | Drag-and-drop disk image installer |
| **ZIP Archive** | [📥 **`Idler-0.2.1-arm64-mac.zip`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.1/Idler-0.2.1-arm64-mac.zip) | Standalone portable `.app` bundle |

**macOS Quickstart:**
1. Download **`Idler-0.2.1-arm64.dmg`** (or unzip `Idler-0.2.1-arm64-mac.zip`).
2. Drag `Idler.app` into your `/Applications` folder.
3. If macOS Gatekeeper alerts on first launch, run:
   ```bash
   xattr -cr /Applications/Idler.app
   ```
4. Click the cozy sloth icon in your top macOS Menu Bar!

---

## 🛠️ Developer Quickstart
```bash
# 1. Clone repository
git clone https://github.com/Kaashviw3spaces/Idler.git
cd Idler

# 2. Start Python Core Backend
python3 -m venv backend/venv
source backend/venv/bin/activate       # On Windows: backend\venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --port 8000

# 3. Start Frontend & Native Desktop App
npm install --prefix frontend
npm run dev --prefix frontend

# 4. Package Native App
# macOS:
bash scripts/package-mac.sh
# Windows:
cd electron && npx electron-builder --win nsis portable zip --x64
```

---

## 🧪 Test Suite Verification
- **51 / 51 tests passing** (`pytest backend/tests`):
  - Integration: Full API endpoint workflows & live task lifecycle.
  - Security: Path traversal, symlink attacks, directory escape tests.
  - Unit: Subfolder preservation, duplicate nesting prevention, action ledger undo, and storage analytics.

---

## 🏆 Hacktoberweek 2026
Built with ❤️ by **@Kaashviw3spaces** for **Hacktoberweek 2026**.  
Star ⭐️ the repository and join us in banishing messy Downloads forever!

