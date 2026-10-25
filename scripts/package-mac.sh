#!/bin/bash
set -e

unset ELECTRON_RUN_AS_NODE

echo "📦 Packaging Idler into native macOS Desktop .app and .dmg..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# 1. Build standalone backend executable with PyInstaller
echo "1/4 Building standalone Python backend (idler-core)..."
mkdir -p backend/dist
PYINSTALLER_CONFIG_DIR=/tmp/pyinstaller PYTHONPATH=. backend/venv/bin/pyinstaller --noconfirm --onedir --name idler-core \
  --distpath backend/dist \
  --paths . \
  --add-data "backend/app:backend/app" \
  backend/app/main.py

# 2. Build frontend distribution
echo "2/4 Building production frontend bundle..."
npm run build --prefix frontend
rm -rf electron/frontend_dist
cp -r frontend/dist electron/frontend_dist

# 3. Package macOS App & DMG
echo "3/4 Packaging Electron macOS Menu Bar App..."
cd electron
npx electron-builder --mac dir
npx electron-builder --mac dmg zip || true

# Update /Applications/Idler.app if it exists
if [ -d "dist/mac-arm64/Idler.app" ]; then
    echo "Syncing updated build to /Applications/Idler.app..."
    pkill -f "Idler.app" || true
    sleep 1
    rm -rf /Applications/Idler.app
    cp -r dist/mac-arm64/Idler.app /Applications/Idler.app
fi

echo "4/4 Build complete!"
echo "Your native macOS Menu Bar App is located at: $DIR/electron/dist/mac-arm64/Idler.app"
if [ -d "$DIR/electron/dist" ]; then
    ls -lh "$DIR/electron/dist"
fi

