#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${1:-webview-test}"
REMOTE_BIN_PATH="${REMOTE_BIN_PATH:-~/metricq-codex}"
REMOTE_TMP_PATH="${REMOTE_TMP_PATH:-~/metricq-codex.new}"
REMOTE_SERVICE="${REMOTE_SERVICE:-metricq-codex.service}"
REMOTE_HEALTH_URL="${REMOTE_HEALTH_URL:-http://127.0.0.1:8086/api/health}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "[1/4] building metricq-codex"
go build -o metricq-codex .

echo "[2/4] uploading binary to ${REMOTE_HOST}:${REMOTE_TMP_PATH}"
scp ./metricq-codex "${REMOTE_HOST}:${REMOTE_TMP_PATH}"

echo "[3/4] activating binary and restarting ${REMOTE_SERVICE}"
ssh "${REMOTE_HOST}" "set -euo pipefail; \
  cp -f ${REMOTE_BIN_PATH} ${REMOTE_BIN_PATH}.bak 2>/dev/null || true; \
  mv -f ${REMOTE_TMP_PATH} ${REMOTE_BIN_PATH}; \
  chmod 700 ${REMOTE_BIN_PATH}; \
  systemctl --user daemon-reload; \
  systemctl --user restart ${REMOTE_SERVICE}; \
  systemctl --user --no-pager --full status ${REMOTE_SERVICE} | sed -n '1,30p'"

echo "[4/4] health check ${REMOTE_HEALTH_URL}"
ssh "${REMOTE_HOST}" "curl -fsS ${REMOTE_HEALTH_URL}"

echo "deploy complete"
