#!/bin/bash
set -e

unset ELECTRON_RUN_AS_NODE

echo "📦 Packaging Idler into native macOS Desktop .app and .dmg..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# 1. Build frontend distribution
echo "1/3 Building production frontend bundle..."
npm run build --prefix frontend
rm -rf electron/frontend_dist
cp -r frontend/dist electron/frontend_dist

# 2. Package macOS App & DMG
echo "2/3 Packaging Electron macOS Menu Bar App..."
cd electron
npx electron-builder --mac dir
npx electron-builder --mac dmg || true

echo "3/3 Build complete!"
echo "Your native macOS Menu Bar App is located at: $DIR/electron/dist/mac/Idler.app"
if [ -d "$DIR/electron/dist" ]; then
    ls -lh "$DIR/electron/dist"
fi

