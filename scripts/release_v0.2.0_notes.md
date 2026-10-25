# 🦥 Idler v0.2.0 — The Cozy Local AI File Butler 🚀
> *Built for Hacktoberweek 2026 — Clean your digital chaos with 100% private, non-destructive Local AI.*

---

## 💡 Why Idler?
Everyone's `~/Downloads` and `~/Desktop` are overflowing digital junkyards. Traditional organizers either upload your sensitive personal files to remote clouds, break your existing code repositories, or make irreversible deletions that induce panic.

**Idler** changes that completely. Running 100% locally on your computer, Idler acts as an autonomous, cozy file butler living right in your **macOS Menu Bar** and **Windows System Tray**. It analyzes loose files, proposes intelligent category routing, and executes atomic, undoable organization—without your files ever leaving your machine.

---

## 📦 Downloads & Installation

> **Zero-Dependency Native Desktop Binaries with Embedded PyInstaller Standalone Core**  
> *Runs out-of-the-box on any computer without requiring Python, Node.js, or external tools.*

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
| **ZIP Archive** | [📥 **`Idler-0.2.0-arm64-mac.zip`**](https://github.com/Kaashviw3spaces/Idler/releases/download/v0.2.0/Idler-0.2.0-arm64-mac.zip) | Standalone portable `.app` bundle |

**macOS Quickstart:**
1. Download **`Idler-0.2.0-arm64.dmg`** (or unzip `Idler-0.2.0-arm64-mac.zip`).
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
daf7742978efd2bed77f1f1e4f49265f7844f4eca663ab1d056bb19f91f99610  Idler.Setup.0.2.0.exe
9b24b679b5bdf8fed9835f26f24c99176fd75de022738ac5bc9f605266124eec  Idler.0.2.0.exe
ba5fd7190d154c2d02c45da6cf91a250558726e8353f2d32fb64a41bee452ca2  Idler-0.2.0-win.zip
0d0591302081e7da0bc3e0f467fe5273db58cbb9fbdf559b32c283cfc828e30e  Idler-0.2.0-arm64.dmg
d68a346fb0e0ff126b4d635fd2286553c63d657d06b6c132654d85f286ddf369  Idler-0.2.0-arm64-mac.zip
```

---

## 🏆 Hacktoberweek 2026
Built with ❤️ by **@Kaashviw3spaces** for **Hacktoberweek 2026**.  
Star ⭐️ the repository and join us in banishing messy Downloads forever!
