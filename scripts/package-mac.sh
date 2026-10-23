#!/bin/bash
set -e

echo "📦 Packaging Idler into native macOS Menu Bar .app and .dmg..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# 1. Build frontend distribution
echo "1/3 Building production frontend bundle..."
npm run build --prefix frontend

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
