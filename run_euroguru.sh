#!/bin/bash

# EuroGuru Web Application Startup Script
# This script runs the fetch script, then starts both backend and frontend

set -e  # Exit on error

echo "=========================================="
echo "🚀 EuroGuru Web Application Startup"
echo "=========================================="

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Activate virtual environment
echo ""
echo "🐍 Activating virtual environment..."
echo "------------------------------------------"
source backend/venv/bin/activate

if [ $? -eq 0 ]; then
    echo "✅ Virtual environment activated"
else
    echo "❌ Failed to activate virtual environment"
    exit 1
fi

# TLS-inspecting proxies (Cloudflare WARP, and corporate MITM generally) re-sign every
# certificate, which Python's bundled certifi roots reject - boto3 then fails every S3
# call with CERTIFICATE_VERIFY_FAILED while curl, which trusts the system keychain,
# works fine. Splicing the proxy's root onto certifi's makes both trustworthy. Neither
# bundle alone is enough: certifi lacks the proxy root, the proxy root lacks the rest.
CF_CERTS=(/Library/Application\ Support/Cloudflare/installed_cert.pem \
          /Library/Application\ Support/Cloudflare/installed_certs/*.pem)
if [ -f "${CF_CERTS[0]}" ]; then
    CA_BUNDLE="$SCRIPT_DIR/backend/.ca-bundle.pem"
    python -c "import certifi,sys; sys.stdout.write(open(certifi.where()).read())" > "$CA_BUNDLE"
    for cert in "${CF_CERTS[@]}"; do
        [ -f "$cert" ] && cat "$cert" >> "$CA_BUNDLE"
    done
    export AWS_CA_BUNDLE="$CA_BUNDLE"
    export REQUESTS_CA_BUNDLE="$CA_BUNDLE"
    echo "✅ CA bundle built for TLS-inspecting proxy ($CA_BUNDLE)"
fi

# Step 1: Run the fetch script to update data
echo ""
echo "📥 Step 1/3: Fetching latest data..."
echo "------------------------------------------"
cd backend
python run_dev_fetch.py
cd "$SCRIPT_DIR"

# Check if fetch was successful
if [ $? -eq 0 ]; then
    echo "✅ Data fetch completed successfully"
else
    echo "⚠️  Warning: Data fetch encountered errors, but continuing..."
fi

# Step 2: Start the Backend (FastAPI)
echo ""
echo "🔧 Step 2/3: Starting Backend Server..."
echo "------------------------------------------"
cd backend

# Start backend in background
echo "Starting FastAPI server on http://localhost:8000"
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait a moment for backend to start
sleep 3

# Step 3: Start the Frontend (Vite)
echo ""
echo "🎨 Step 3/3: Starting Frontend Server..."
echo "------------------------------------------"
cd ../frontend

# Start frontend in background
echo "Starting Vite dev server on http://localhost:5173"
npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

# Return to root directory
cd "$SCRIPT_DIR"

echo ""
echo "=========================================="
echo "✅ All services started successfully!"
echo "=========================================="
echo ""
echo "📊 Backend API:  http://localhost:8000"
echo "🌐 Frontend UI:  http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo "✅ All services stopped"
    exit 0
}

# Trap Ctrl+C and call cleanup
trap cleanup INT TERM

# Wait for both processes
wait
