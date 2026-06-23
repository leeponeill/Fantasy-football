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
PI_LEAGUE_STATE_RELATIVE_PATH="data/league-state.json"
PI_LEAGUE_STATE_BACKUP_RELATIVE_PATH=".deploy-preserve/league-state.json"
PI_LEAGUE_STATE_UNDERSCORE_RELATIVE_PATH="data/league_state.json"
PI_LEAGUE_STATE_UNDERSCORE_BACKUP_RELATIVE_PATH=".deploy-preserve/league_state.json"
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

run_ssh_status() {
  local remote_command="$1"
  local escaped_remote_command
  printf -v escaped_remote_command '%q' "${remote_command}"

  ssh "${SSH_COMMON_OPTS[@]}" "${SSH_TARGET}" "bash -lc ${escaped_remote_command}"
}

remote_port_is_listening() {
  ssh "${SSH_COMMON_OPTS[@]}" "${SSH_TARGET}" "bash -lc 'ss -ltn 2>/dev/null | grep -q ":${PI_SERVER_PORT}[[:space:]]"'"
}

run_rsync() {
  if ! rsync "$@"; then
    echo "Error: rsync to ${SSH_TARGET} failed."
    echo "Hint: check SSH auth and remote disk space."
    exit 1
  fi
}

verify_remote_write_access() {
  local remote_command
  remote_command="
    set -euo pipefail
    target='${PI_APP_DIR}'
    mkdir -p \"\${target}\"
    probe=\"\${target}/.deploy-write-test-\$\$\"
    : > \"\${probe}\"
    rm -f \"\${probe}\"
    echo 'remote-write-check-ok'
  "

  local escaped_remote_command
  printf -v escaped_remote_command '%q' "${remote_command}"

  if ! ssh "${SSH_COMMON_OPTS[@]}" "${SSH_TARGET}" "bash -lc ${escaped_remote_command}"; then
    echo "Error: remote filesystem preflight failed on ${SSH_TARGET}."
    echo "Hint: if you saw 'Input/output error', the Pi storage may be failing or mounted read-only."
    echo "Run on the Pi: df -h ; mount | grep ' / ' ; dmesg -T | tail -n 120"
    exit 1
  fi
}

require_command npm
require_command ssh
require_command rsync

echo "[deploy] Checking SSH connectivity to ${SSH_TARGET}..."
run_ssh "echo 'SSH connection OK'"

echo "[deploy] Checking remote write access..."
verify_remote_write_access

echo "[deploy] Building app locally..."
npm run build

echo "[deploy] Ensuring remote app directory exists..."
run_ssh "mkdir -p '${PI_APP_DIR}'"

echo "[deploy] Preserving remote ${PI_LEAGUE_STATE_RELATIVE_PATH} (if present)..."
run_ssh "
  set -euo pipefail
  mkdir -p '${PI_APP_DIR}/.deploy-preserve'
  if [[ -f '${PI_APP_DIR}/${PI_LEAGUE_STATE_RELATIVE_PATH}' ]]; then
    cp '${PI_APP_DIR}/${PI_LEAGUE_STATE_RELATIVE_PATH}' '${PI_APP_DIR}/${PI_LEAGUE_STATE_BACKUP_RELATIVE_PATH}'
  fi
  if [[ -f '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_RELATIVE_PATH}' ]]; then
    cp '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_RELATIVE_PATH}' '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_BACKUP_RELATIVE_PATH}'
  fi
"

echo "[deploy] Syncing project files to Raspberry Pi..."
run_rsync -az --delete \
  -e "ssh -p ${PI_PORT} -o ConnectTimeout=${PI_CONNECT_TIMEOUT} -o StrictHostKeyChecking=${PI_SSH_STRICT_HOST_KEY_CHECKING}" \
  --filter='P data/league-state.json' \
  --filter='P data/league_state.json' \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'android-fixtures-webview/' \
  --exclude 'dist/' \
  --exclude 'league_backup/' \
  --exclude '.DS_Store' \
  --exclude 'data/league-state.json' \
  ./ "${SSH_TARGET}:${PI_APP_DIR}/"

echo "[deploy] Syncing built dist output..."
run_rsync -az --delete \
  -e "ssh -p ${PI_PORT} -o ConnectTimeout=${PI_CONNECT_TIMEOUT} -o StrictHostKeyChecking=${PI_SSH_STRICT_HOST_KEY_CHECKING}" \
  ./dist/ "${SSH_TARGET}:${PI_APP_DIR}/dist/"

echo "[deploy] Restoring preserved ${PI_LEAGUE_STATE_RELATIVE_PATH}..."
run_ssh "
  set -euo pipefail
  mkdir -p '${PI_APP_DIR}/data'
  if [[ -f '${PI_APP_DIR}/${PI_LEAGUE_STATE_BACKUP_RELATIVE_PATH}' ]]; then
    mv '${PI_APP_DIR}/${PI_LEAGUE_STATE_BACKUP_RELATIVE_PATH}' '${PI_APP_DIR}/${PI_LEAGUE_STATE_RELATIVE_PATH}'
  fi
  if [[ -f '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_BACKUP_RELATIVE_PATH}' ]]; then
    mv '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_BACKUP_RELATIVE_PATH}' '${PI_APP_DIR}/${PI_LEAGUE_STATE_UNDERSCORE_RELATIVE_PATH}'
  fi
"

echo "[deploy] Updating dependencies and restarting app on Raspberry Pi..."

verify_remote_port_is_listening() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if remote_port_is_listening; then
      return 0
    fi
    sleep 1
  done

  return 1
}

restart_or_start_remote_app() {
  local remote_command="$1"
  run_ssh_status "${remote_command}" || true

  if verify_remote_port_is_listening; then
    echo "[deploy] Remote app is listening on port ${PI_SERVER_PORT}."
    return 0
  fi

  echo "Error: remote app did not open port ${PI_SERVER_PORT}."
  echo "Hint: check the Pi app log at ${PI_APP_DIR}/app.log or the remote service status."
  return 1
}

if [[ -n "${PI_SERVICE}" ]]; then
  SYSTEMCTL="systemctl"
  if [[ "${PI_USE_SUDO}" == "true" ]]; then
    SYSTEMCTL="sudo systemctl"
  fi

  restart_or_start_remote_app "
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

    unit_state=\$(${SYSTEMCTL} show -p LoadState --value '${PI_SERVICE}.service' 2>/dev/null || true)
    if [[ \"\${unit_state}\" != \"not-found\" && -n \"\${unit_state}\" ]]; then
      ${SYSTEMCTL} daemon-reload || true
      ${SYSTEMCTL} restart '${PI_SERVICE}'
      ${SYSTEMCTL} --no-pager --full status '${PI_SERVICE}' | head -n 20 || true
    else
      echo 'Warning: configured service not found; starting detached app instead.'
      for attempt in 1 2 3 4 5; do
        port_pids=\"\"
        if command -v lsof >/dev/null 2>&1; then
          port_pids=\"\$(lsof -t -iTCP:${PI_SERVER_PORT} -sTCP:LISTEN 2>/dev/null || true)\"
        elif command -v fuser >/dev/null 2>&1; then
          port_pids=\"\$(fuser -n tcp ${PI_SERVER_PORT} 2>/dev/null || true)\"
        elif command -v ss >/dev/null 2>&1; then
          port_pids=\"\$(ss -ltnp 2>/dev/null | awk '/:${PI_SERVER_PORT}[[:space:]]/ { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART+4, RLENGTH-4) }' || true)\"
        fi

        existing_pids=\"\$(pgrep -f '^node( .*)? server\\.mjs( |$)' || true)\"
        if [[ -n \"\${port_pids}\" ]]; then
          kill \${port_pids} || true
        fi
        if [[ -n \"\${existing_pids}\" ]]; then
          kill \${existing_pids} || true
        fi

        sleep 1
      done

      nohup ${PI_START_COMMAND} > '${PI_APP_DIR}/app.log' 2>&1 < /dev/null &
    fi
  "
else
  restart_or_start_remote_app "
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

    for attempt in 1 2 3 4 5; do
      port_pids=\"\"
      if command -v lsof >/dev/null 2>&1; then
        port_pids=\"\$(lsof -t -iTCP:${PI_SERVER_PORT} -sTCP:LISTEN 2>/dev/null || true)\"
      elif command -v fuser >/dev/null 2>&1; then
        port_pids=\"\$(fuser -n tcp ${PI_SERVER_PORT} 2>/dev/null || true)\"
      elif command -v ss >/dev/null 2>&1; then
        port_pids=\"\$(ss -ltnp 2>/dev/null | awk '/:${PI_SERVER_PORT}[[:space:]]/ { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART+4, RLENGTH-4) }' || true)\"
      fi

      existing_pids=\"\$(pgrep -f '^node( .*)? server\\.mjs( |$)' || true)\"
      if [[ -n \"\${port_pids}\" ]]; then
        kill \${port_pids} || true
      fi
      if [[ -n \"\${existing_pids}\" ]]; then
        kill \${existing_pids} || true
      fi

      sleep 1
    done

    nohup ${PI_START_COMMAND} > '${PI_APP_DIR}/app.log' 2>&1 < /dev/null &
  "
fi

if verify_remote_port_is_listening; then
  echo "[deploy] Deployment completed successfully."
else
  echo "Error: remote app did not open port ${PI_SERVER_PORT}."
  echo "Hint: check the Pi app log at ${PI_APP_DIR}/app.log or the remote service status."
  exit 1
fi
``