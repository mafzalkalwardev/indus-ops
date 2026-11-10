#!/usr/bin/env bash
# Install INDUS Ops on the existing Ubuntu 24.04 VPS (arm64 or amd64).
# Does not use Docker. Does not touch MailForge's database except optional mongodump.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-vps.sh"
  exit 1
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${INSTALL_DIR:-/opt/indus}"
MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"

if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Node.js 20+ is required. MailForge's Node is fine if it is already 20 or newer."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl sqlite3 build-essential python3 ffmpeg

if ! command -v ollama >/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama || true
ollama pull "${MODEL}"

arch="$(uname -m)"
case "${arch}" in
  aarch64|arm64) piper_asset="piper_linux_aarch64.tar.gz" ;;
  x86_64) piper_asset="piper_linux_x86_64.tar.gz" ;;
  *) piper_asset="" ;;
esac
if [[ -n "${piper_asset}" && ! -x /opt/piper/piper ]]; then
  mkdir -p /opt/piper
  curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${piper_asset}" | tar -xz -C /opt/piper --strip-components=1 || echo "Piper download failed. Videos still render with captions and the bundled tone bed."
fi

id indus >/dev/null 2>&1 || useradd --system --home "${DEST}" --shell /usr/sbin/nologin indus
mkdir -p "${DEST}"
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "${SRC}/" "${DEST}/"
mkdir -p "${DEST}/shared" "${DEST}/data"
chown -R indus:indus "${DEST}"

if [[ ! -f "${DEST}/.env" ]]; then
  enc="$(openssl rand -hex 32)"
  bot="$(openssl rand -hex 24)"
  sso="$(openssl rand -hex 24)"
  setup="$(openssl rand -hex 12)"
  webhook="$(openssl rand -hex 18)"
  cat > "${DEST}/.env" <<EOF
HOST=127.0.0.1
INDUS_BOT_TOKEN=${bot}
INDUS_SSO_SECRET=${sso}
INDUS_ENCRYPTION_KEY=${enc}
INDUS_SETUP_TOKEN=${setup}
INDUS_SHARED_DIR=${DEST}/shared
HUB_URL=http://127.0.0.1:41731
SCHEDULER_URL=http://127.0.0.1:41748
INDUS_LLM_PROVIDER=ollama
LLM_MODEL=${MODEL}
OLLAMA_BASE_URL=http://127.0.0.1:11434
LLM_TIMEOUT_MS=240000
COOKIE_SECURE=1
TRUST_PROXY=1
WEBHOOK_SECRET=${webhook}
MAILFORGE_BASE_URL=http://127.0.0.1:5000
EOF
  chmod 600 "${DEST}/.env"
  chown indus:indus "${DEST}/.env"
  echo "Setup token (paste it once on the first visit): ${setup}"
  echo "Webhook secret: ${webhook}"
fi

sudo -u indus bash -lc "cd '${DEST}' && npm install"

for unit in "${DEST}"/indus-*/deploy/*.service "${DEST}"/indus-ops/deploy/*.service; do
  [[ -f "${unit}" ]] || continue
  name="$(basename "${unit}")"
  sed "s#/opt/indus#${DEST}#g" "${unit}" > "/etc/systemd/system/${name}"
done
systemctl daemon-reload
for name in indus-ops indus-scheduler-bot indus-commander-bot indus-monitor-bot indus-seo-bot indus-mailforge-bot indus-inquiries-bot indus-leads-bot indus-reports-bot indus-marketing-bot indus-security-bot indus-backup-bot indus-devops-bot indus-content-bot indus-translator-bot indus-crm-bot indus-invoice-bot indus-support-bot indus-competitor-bot indus-analytics-bot; do
  systemctl enable --now "${name}" || true
done

if [[ -d /etc/nginx/sites-available ]]; then
  cp "${DEST}/deploy/nginx-ops.conf" /etc/nginx/sites-available/indus-ops.conf
  ln -sfn /etc/nginx/sites-available/indus-ops.conf /etc/nginx/sites-enabled/indus-ops.conf
  echo "Nginx site installed. Obtain the certificate, then reload nginx:"
  echo "  certbot certonly --webroot -w /var/www/certbot -d ops.induswebagency.com"
  echo "  nginx -t && systemctl reload nginx"
fi

echo "Hub will listen on 127.0.0.1:41731. Open https://ops.induswebagency.com after DNS and the certificate exist."
