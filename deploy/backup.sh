#!/usr/bin/env bash
set -euo pipefail
DEST="${INSTALL_DIR:-/opt/indus}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${DEST}/backups/${STAMP}"
mkdir -p "${OUT}"
sudo -u indus node --input-type=module -e "
import Database from 'better-sqlite3';
import { readdirSync, copyFileSync, mkdirSync } from 'fs';
import path from 'path';
const root = process.argv[1];
const out = process.argv[2];
for (const dir of readdirSync(root)) {
  const data = path.join(root, dir, 'data');
  try {
    for (const file of readdirSync(data)) {
      if (!file.endsWith('.sqlite')) continue;
      const target = path.join(out, dir + '-' + file);
      const db = new Database(path.join(data, file), { readonly: true });
      await db.backup(target);
      db.close();
    }
  } catch {}
}
" "${DEST}" "${OUT}"
cp -a "${DEST}/.env" "${OUT}/env.bak"
[[ -d /etc/nginx ]] && tar -C /etc -czf "${OUT}/nginx.tgz" nginx
echo "Backup in ${OUT}. It contains secrets. Keep it off the web."
find "${DEST}/backups" -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
