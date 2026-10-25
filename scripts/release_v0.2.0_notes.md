# 🦥 Idler v0.2.0 — The Cozy Local AI File Butler 🚀
> *Built for Hacktoberweek 2026 — Clean your digital chaos with 100% private, non-destructive Local AI.*

---

## 💡 Why Idler?
Everyone's `~/Downloads` and `~/Desktop` are overflowing digital junkyards. Traditional organizers either upload your sensitive personal files to remote clouds, break your existing code repositories, or make irreversible deletions that induce panic.

**Idler** changes that completely. Running 100% locally on your computer, Idler acts as an autonomous, cozy file butler living right in your **macOS Menu Bar** and **Windows System Tray**. It analyzes loose files, proposes intelligent category routing, and executes atomic, undoable organization—without your files ever leaving your machine.

---

## 📦 Downloads & Installation

### 🪟 Windows (10 / 11 64-bit)
| Package | File | Description |
|---|---|---|
| **Installer (Recommended)** | [📥 **`Idler.Setup.0.2.0.exe`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler.Setup.0.2.0.exe) | One-click setup installer with Start Menu & System Tray shortcuts |
| **Portable Executable** | [📥 **`Idler.0.2.0.exe`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler.0.2.0.exe) | Single-file portable executable. Run immediately without installation |
| **Portable ZIP** | [📥 **`Idler-0.2.0-win.zip`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler-0.2.0-win.zip) | Standalone unpacked folder archive |

**Windows Quickstart:**
1. Download **`Idler.Setup.0.2.0.exe`** (or **`Idler.0.2.0.exe`**).
2. Run the application. Idler will appear immediately in your bottom-right **Windows System Tray** (next to the clock).
3. Click the sloth tray icon to open the cozy popover menu, sort files, and preview items!
4. *(Optional)* Windows SmartScreen prompt: Click *"More info"* ➔ *"Run anyway"* (common for freshly published open-source releases).

---

### 🍏 macOS (Apple Silicon / arm64)
| Package | File | Description |
|---|---|---|
| **DMG Installer (Recommended)** | [📥 **`Idler-0.2.0-arm64.dmg`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler-0.2.0-arm64.dmg) | Drag-and-drop disk image installer |
| **ZIP Archive** | [📥 **`Idler-v0.2.0-mac-arm64.zip`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler-v0.2.0-mac-arm64.zip) | Standalone portable `.app` bundle |

**macOS Quickstart:**
1. Download **`Idler-0.2.0-arm64.dmg`** (or unzip `Idler-v0.2.0-mac-arm64.zip`).
2. Drag `Idler.app` into your `/Applications` folder.
3. If macOS Gatekeeper alerts on first launch, run:
   ```bash
   xattr -cr /Applications/Idler.app
   ```
4. Click the cozy sloth icon in your top macOS Menu Bar!

---

## ✨ What's New in v0.2.0

### 🎯 1. Subfolder-Preserving Targeted Quick Sort
- **Zero Repos Destroyed**: Unlike naive organizers that pull nested code out of git repositories or submodules, Idler recognizes project directories (`Rishiverse-Extension-main`, `newNewton-main`, `nst-attendance-main`, etc.) and leaves their internal structure intact.
- **Subfolder Targeting**: You can sort loose files directly within specific subfolders into their own category folders (e.g. sorting loose files inside `Idler/` into `Idler/Code` and `Idler/Documents`).
- **Duplicate Nesting Prevention**: Idler prevents redundant category recursion (e.g. classifying an image already inside `Images/` will never generate `Images/Images/photo.png`).
- **Zero-Clutter Dropdown**: The quick sort menu only displays targets with $> 0$ sortable actions, keeping your menu bar compact and uncluttered.

### 📊 2. Compact Storage Analytics & Treemap
- **Disk Usage Insights**: Live breakdown of workspace folders, subfolder weights, and category distributions.
- **Forgotten Large File Detection**: Automatically uncovers forgotten files (>500MB, untouched for >180 days).
- **Cold Storage Archiver**: Pack forgotten media and stale archives into compressed `.tar.gz` cold storage with a single click.
- **Safe Soft Trashing**: Safely moves space-wasting files into the native macOS Trash / Windows Recycle Bin via `send2trash`.

### 🛡️ 3. Safety Guarantees & Non-Destructive Ledger
- **Dry-Run Approval**: Every proposed plan must be reviewed and explicitly approved before any file moves on disk.
- **Action Ledger & Instant Undo**: Every single file operation (move, rename, archive) is permanently logged to a local SQLite ledger. Click **Undo** on any action to reverse it immediately.
- **Security & Sandboxing**: Strict workspace boundary verification, path traversal protection (`../` prevention), and system folder blacklisting (`/System`, `/Library`, `C:\Windows`).

### 🔍 4. Cryptographic Duplicate Finder
- **SHA-256 Chunked Hashing**: Detects identical duplicate files with zero false positives.
- **One-Click Redundancy Trashing**: Free up gigabytes by automatically identifying duplicate copies while preserving the primary file.

### 👁️ 5. Universal QuickLook File Preview Modal
- Instant, rich in-app preview for:
  - 📊 Spreadsheets (`.xlsx`, `.xls`, `.csv`, `.tsv`)
  - 📑 Documents & Text (`.docx`, `.pdf`, `.txt`, `.md`)
  - 🖼️ Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`)
  - 💻 Source Code (`.py`, `.ts`, `.tsx`, `.js`, `.json`, `.rs`, `.go`, etc.)

### 🔔 6. Native Audio Completion Chimes
- Cozy OS-native auditory feedback upon task completion:
  - **macOS**: System `Glass` / `Hero` harmonic chime.
  - **Windows**: Ascending System Asterisk triad.

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

## 🔒 Checksums (SHA-256)
```text
7de44229d6c00dfb0b118e1602cf321e65b690ae8eb72bac34e6edec13873c0f  Idler.Setup.0.2.0.exe
e9c7f77bc60a8d14b06ddc875bcb39a7456ceae640abb4b136adc4b60bd1e498  Idler.0.2.0.exe
947855195921a632ff84df92bf9a811caa0edc945364c82e38d259a26f67e2cb  Idler-0.2.0-win.zip
3588d8fb562a6a944a5c04cc2c1b98b635be7fa5eef9f1ab98255e1e5cd09269  Idler-0.2.0-arm64.dmg
4c482eebc45f95953237e8929e189e3ff83cc9bedacd3e575aaeb698735e0d21  Idler-0.2.0-arm64-mac.zip
efbb9155ab3b35dbd3d8051bd29c1c0352e48caca7cb5d5a423328f52f5ff8f9  Idler-v0.2.0-mac-arm64.zip
```

---

## 🏆 Hacktoberweek 2026
Built with ❤️ by **@Kaashviw3spaces** for **Hacktoberweek 2026**.  
Star ⭐️ the repository and join us in banishing messy Downloads forever!

