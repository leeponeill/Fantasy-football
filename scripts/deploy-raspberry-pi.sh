#!/usr/bin/env bash
set -euo pipefail

# Deploy this project to a Raspberry Pi.
#
# Required env vars:
# - PI_HOST: Raspberry Pi host/IP
#
# Optional env vars:
# - PI_USER: SSH username (default: pi)
# - PI_PORT: SSH port (default: 22)
# - PI_APP_DIR: Remote app directory (default: /home/<PI_USER>/fantasy_football)
# - PI_SERVICE: systemd service name on Pi (if set, service restart is used)
# - PI_START_COMMAND: command to run when PI_SERVICE is not set
#                     (default: npm run host:lan)
# - PI_USE_SUDO: when true and PI_SERVICE is set, uses sudo for systemctl

if [[ -z "${PI_HOST:-}" ]]; then
  echo "Error: PI_HOST is required."
  echo "Example: PI_HOST=192.168.1.50 PI_USER=lee npm run deploy:pi"
  exit 1
fi

PI_USER="${PI_USER:-pi}"
PI_PORT="${PI_PORT:-22}"
PI_APP_DIR="${PI_APP_DIR:-/home/${PI_USER}/fantasy_football}"
PI_SERVICE="${PI_SERVICE:-}"
PI_START_COMMAND="${PI_START_COMMAND:-npm run host:lan}"
PI_USE_SUDO="${PI_USE_SUDO:-false}"

SSH_TARGET="${PI_USER}@${PI_HOST}"
SSH_OPTS=(-p "${PI_PORT}")

echo "[deploy] Building app locally..."
npm run build

echo "[deploy] Ensuring remote app directory exists..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "mkdir -p '${PI_APP_DIR}'"

echo "[deploy] Syncing project files to Raspberry Pi..."
rsync -az --delete \
  -e "ssh -p ${PI_PORT}" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'android-fixtures-webview/' \
  --exclude 'dist/' \
  --exclude '.DS_Store' \
  --exclude 'data/league-state.json' \
  ./ "${SSH_TARGET}:${PI_APP_DIR}/"

echo "[deploy] Syncing built dist output..."
rsync -az --delete \
  -e "ssh -p ${PI_PORT}" \
  ./dist/ "${SSH_TARGET}:${PI_APP_DIR}/dist/"

echo "[deploy] Updating dependencies and restarting app on Raspberry Pi..."
if [[ -n "${PI_SERVICE}" ]]; then
  SYSTEMCTL="systemctl"
  if [[ "${PI_USE_SUDO}" == "true" ]]; then
    SYSTEMCTL="sudo systemctl"
  fi

  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "
    set -euo pipefail
    if ! command -v npm >/dev/null 2>&1; then
      export NVM_DIR=\"\$HOME/.nvm\"
      if [ -s \"\$NVM_DIR/nvm.sh\" ]; then
        . \"\$NVM_DIR/nvm.sh\"
      fi
    fi
    if ! command -v npm >/dev/null 2>&1; then
      echo 'Error: npm not found on Raspberry Pi PATH. Install Node.js/npm or configure shell startup for non-interactive SSH.'
      exit 1
    fi
    cd '${PI_APP_DIR}'
    npm install --omit=dev
    ${SYSTEMCTL} daemon-reload || true
    ${SYSTEMCTL} restart '${PI_SERVICE}'
    ${SYSTEMCTL} --no-pager --full status '${PI_SERVICE}' | head -n 20 || true
  "
else
  ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "
    set -euo pipefail
    if ! command -v npm >/dev/null 2>&1; then
      export NVM_DIR=\"\$HOME/.nvm\"
      if [ -s \"\$NVM_DIR/nvm.sh\" ]; then
        . \"\$NVM_DIR/nvm.sh\"
      fi
    fi
    if ! command -v npm >/dev/null 2>&1; then
      echo 'Error: npm not found on Raspberry Pi PATH. Install Node.js/npm or configure shell startup for non-interactive SSH.'
      exit 1
    fi
    cd '${PI_APP_DIR}'
    npm install --omit=dev

    # Stop old process if running.
    pkill -f 'node server.mjs' || true

    # Start new process detached from shell.
    nohup ${PI_START_COMMAND} > '${PI_APP_DIR}/app.log' 2>&1 < /dev/null &
    sleep 1
    pgrep -af 'node server.mjs' || true
  "
fi

echo "[deploy] Deployment completed successfully."
