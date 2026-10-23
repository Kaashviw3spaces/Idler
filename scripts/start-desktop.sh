#!/bin/bash
set -e

echo "🦥 Launching Idler Menu Bar Desktop App..."

# Get project root
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$DIR"

# Ensure backend server is running
if ! curl -s http://127.0.0.1:8000/api/health > /dev/null 2>&1; then
    echo "Starting Idler backend server on port 8000..."
    backend/venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
    BACKEND_PID=$!
    sleep 1
fi

# Build frontend if dist does not exist
if [ ! -d "frontend/dist" ]; then
    echo "Building frontend..."
    npm run build --prefix frontend
fi

# Launch Electron tray app
cd electron
npx electron .
