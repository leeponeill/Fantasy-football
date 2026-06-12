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
PI_START_COMMAND="${PI_START_COMMAND:-node server.mjs --host 0.0.0.0 --port 4173}"
PI_SERVER_PORT="${PI_SERVER_PORT:-4173}"
PI_USE_SUDO="${PI_USE_SUDO:-false}"
PI_CONNECT_TIMEOUT="${PI_CONNECT_TIMEOUT:-8}"
PI_SSH_STRICT_HOST_KEY_CHECKING="${PI_SSH_STRICT_HOST_KEY_CHECKING:-accept-new}"

SSH_TARGET="${PI_USER}@${PI_HOST}"
SSH_COMMON_OPTS=(
  -p "${PI_PORT}"
  -o "ConnectTimeout=${PI_CONNECT_TIMEOUT}"
  -o "StrictHostKeyChecking=${PI_SSH_STRICT_HOST_KEY_CHECKING}"
)

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Error: required command '${command_name}' is not available on this machine."
    exit 1
  fi
}

run_ssh() {
  local remote_command="$1"
  local escaped_remote_command
  printf -v escaped_remote_command '%q' "${remote_command}"

  if ! ssh "${SSH_COMMON_OPTS[@]}" "${SSH_TARGET}" "bash -lc ${escaped_remote_command}"; then
    echo "Error: SSH command failed for ${SSH_TARGET}."
    echo "Hint: verify PI_HOST/PI_USER, network reachability, and SSH auth keys."
    exit 1
  fi
}

run_rsync() {
  if ! rsync "$@"; then
    echo "Error: rsync to ${SSH_TARGET} failed."
    echo "Hint: check SSH auth and remote disk space."
    exit 1
  fi
}

require_command npm
require_command ssh
require_command rsync

echo "[deploy] Checking SSH connectivity to ${SSH_TARGET}..."
run_ssh "echo 'SSH connection OK'"

echo "[deploy] Building app locally..."
npm run build

echo "[deploy] Ensuring remote app directory exists..."
run_ssh "mkdir -p '${PI_APP_DIR}'"

echo "[deploy] Syncing project files to Raspberry Pi..."
run_rsync -az --delete \
  -e "ssh -p ${PI_PORT} -o ConnectTimeout=${PI_CONNECT_TIMEOUT} -o StrictHostKeyChecking=${PI_SSH_STRICT_HOST_KEY_CHECKING}" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'android-fixtures-webview/' \
  --exclude 'dist/' \
  --exclude '.DS_Store' \
  --exclude 'data/league-state.json' \
  ./ "${SSH_TARGET}:${PI_APP_DIR}/"

echo "[deploy] Syncing built dist output..."
run_rsync -az --delete \
  -e "ssh -p ${PI_PORT} -o ConnectTimeout=${PI_CONNECT_TIMEOUT} -o StrictHostKeyChecking=${PI_SSH_STRICT_HOST_KEY_CHECKING}" \
  ./dist/ "${SSH_TARGET}:${PI_APP_DIR}/dist/"

echo "[deploy] Updating dependencies and restarting app on Raspberry Pi..."
if [[ -n "${PI_SERVICE}" ]]; then
  SYSTEMCTL="systemctl"
  if [[ "${PI_USE_SUDO}" == "true" ]]; then
    SYSTEMCTL="sudo systemctl"
  fi

  run_ssh "
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
  run_ssh "
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

    # Stop old app process by known server port first.
    port_pids=\"\"
    if command -v lsof >/dev/null 2>&1; then
      port_pids=\"\$(lsof -t -iTCP:${PI_SERVER_PORT} -sTCP:LISTEN 2>/dev/null || true)\"
    elif command -v fuser >/dev/null 2>&1; then
      port_pids=\"\$(fuser -n tcp ${PI_SERVER_PORT} 2>/dev/null || true)\"
    elif command -v ss >/dev/null 2>&1; then
      port_pids=\"\$(ss -ltnp 2>/dev/null | awk '/:${PI_SERVER_PORT}[[:space:]]/ { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART+4, RLENGTH-4) }' || true)\"
    fi
    if [[ -n \"\${port_pids}\" ]]; then
      kill \${port_pids} || true
      sleep 1
    fi

    # Stop old app process if running without matching this deploy shell command.
    existing_pids=\"\$(pgrep -f '^node( .*)? server\\.mjs( |$)' || true)\"
    if [[ -n \"\${existing_pids}\" ]]; then
      kill \${existing_pids} || true
      sleep 1
    fi

    # Start new process detached from shell.
    nohup ${PI_START_COMMAND} > '${PI_APP_DIR}/app.log' 2>&1 < /dev/null &
    sleep 2
    if ! pgrep -af '^node( .*)? server\\.mjs( |$)' >/dev/null 2>&1; then
      echo 'Error: server process did not stay up after start.'
      tail -n 60 '${PI_APP_DIR}/app.log' || true
      exit 1
    fi
    pgrep -af '^node( .*)? server\\.mjs( |$)' || true
  "
fi

echo "[deploy] Deployment completed successfully."
``