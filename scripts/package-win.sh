#!/bin/bash
set -e

echo "📦 Packaging Idler for Windows (x64 & arm64)..."

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# 1. Ensure frontend production bundle is fresh
echo "1/4 Ensuring production frontend bundle..."
npm run build --prefix frontend
rm -rf electron/frontend_dist
cp -r frontend/dist electron/frontend_dist

# 2. Prepare staging app directory
echo "2/4 Preparing Electron application payload..."
STAGE="$DIR/electron/dist/staging_app"
rm -rf "$STAGE"
mkdir -p "$STAGE"

cp "$DIR/electron/package.json" "$STAGE/"
cp "$DIR/electron/main.cjs" "$STAGE/"
cp "$DIR/electron/preload.cjs" "$STAGE/"
cp -r "$DIR/electron/assets" "$STAGE/"
cp -r "$DIR/electron/frontend_dist" "$STAGE/"

# Pack into app.asar
ASAR="$DIR/electron/dist/app.asar"
rm -f "$ASAR"
"$DIR/electron/node_modules/.bin/asar" pack "$STAGE" "$ASAR"
echo "  ✓ Generated app.asar ($(du -sh "$ASAR" | cut -f1))"

# 3. Assemble Windows x64 Distribution
CACHE_X64="$HOME/Library/Caches/electron/electron-v34.5.8-win32-x64.zip"
if [ -f "$CACHE_X64" ]; then
    echo "3/4 Assembling Windows x64 standalone package..."
    WIN_X64_DIR="$DIR/electron/dist/Idler-win-x64"
    rm -rf "$WIN_X64_DIR"
    mkdir -p "$WIN_X64_DIR"
    
    unzip -q "$CACHE_X64" -d "$WIN_X64_DIR"
    mv "$WIN_X64_DIR/electron.exe" "$WIN_X64_DIR/Idler.exe"
    cp "$ASAR" "$WIN_X64_DIR/resources/app.asar"
    
    # Add convenience launcher batch script
    cat << 'EOF' > "$WIN_X64_DIR/Run-Idler.bat"
@echo off
start "" "%~dp0Idler.exe"
EOF
    
    # Add Windows README
    cat << 'EOF' > "$WIN_X64_DIR/README-WINDOWS.txt"
=====================================================
 Idler — Local-First AI Agent (Windows Edition)
=====================================================

To run Idler:
1. Double-click "Idler.exe" (or "Run-Idler.bat").
2. The sloth mascot icon will appear in your Windows System Tray (bottom right notification area).
3. Click the sloth icon anytime to open the popover!
4. Right-click the sloth icon for settings, chimes, and web studio mode.

Enjoy effortless computer housekeeping!
EOF

    # Create ZIP archive
    ZIP_X64="$DIR/electron/dist/Idler-0.1.0-windows-x64.zip"
    rm -f "$ZIP_X64"
    cd "$DIR/electron/dist"
    zip -q -r "Idler-0.1.0-windows-x64.zip" "Idler-win-x64"
    echo "  ✓ Built Idler-0.1.0-windows-x64.zip ($(du -sh "$ZIP_X64" | cut -f1))"
    cd "$DIR"
fi

# 4. Assemble Windows arm64 Distribution (for Surface Pro / ARM laptops)
CACHE_ARM64="$HOME/Library/Caches/electron/electron-v34.5.8-win32-arm64.zip"
if [ -f "$CACHE_ARM64" ]; then
    echo "4/4 Assembling Windows arm64 standalone package..."
    WIN_ARM64_DIR="$DIR/electron/dist/Idler-win-arm64"
    rm -rf "$WIN_ARM64_DIR"
    mkdir -p "$WIN_ARM64_DIR"
    
    unzip -q "$CACHE_ARM64" -d "$WIN_ARM64_DIR"
    mv "$WIN_ARM64_DIR/electron.exe" "$WIN_ARM64_DIR/Idler.exe"
    cp "$ASAR" "$WIN_ARM64_DIR/resources/app.asar"
    
    cat << 'EOF' > "$WIN_ARM64_DIR/Run-Idler.bat"
@echo off
start "" "%~dp0Idler.exe"
EOF

    ZIP_ARM64="$DIR/electron/dist/Idler-0.1.0-windows-arm64.zip"
    rm -f "$ZIP_ARM64"
    cd "$DIR/electron/dist"
    zip -q -r "Idler-0.1.0-windows-arm64.zip" "Idler-win-arm64"
    echo "  ✓ Built Idler-0.1.0-windows-arm64.zip ($(du -sh "$ZIP_ARM64" | cut -f1))"
    cd "$DIR"
fi

# Clean temporary staging
rm -rf "$STAGE" "$ASAR"

echo ""
echo "🎉 Windows packages built successfully!"
ls -lh "$DIR/electron/dist/"*windows*.zip

