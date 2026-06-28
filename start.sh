#!/bin/bash
# Start North Star Media Dossiers app (server + client)
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20

echo "Starting North Star Media Dossiers..."
echo ""

# Kill any existing instances
pkill -f "ts-node src/index.ts" 2>/dev/null
pkill -f "vite.*northstar" 2>/dev/null
sleep 1

# Start backend
cd "$(dirname "$0")/server"
npx ts-node src/index.ts &
SERVER_PID=$!
echo "✓ Server started (PID $SERVER_PID) → http://localhost:3001"

# Start frontend
cd "$(dirname "$0")/client"
npm run dev &
CLIENT_PID=$!
echo "✓ Client started (PID $CLIENT_PID) → http://localhost:5173"
echo ""
echo "Open http://localhost:5173 in your browser."
echo "Press Ctrl+C to stop."

# Wait and cleanup on exit
trap "kill $SERVER_PID $CLIENT_PID 2>/dev/null; echo 'Stopped.'" EXIT INT
wait
