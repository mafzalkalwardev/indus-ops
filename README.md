# INDUS Ops

A self-hosted fleet for [INDUS Web Agency](https://induswebagency.com). One hub, one scheduler, one commander, and a bot per job. Everything binds to `127.0.0.1`. The only public site is `https://ops.induswebagency.com`, which nginx proxies to the hub.

The local model is Ollama on CPU. Default model: `qwen2.5:3b` (Q4). Change `LLM_MODEL` if you want `llama3.2:3b` or a smaller `qwen2.5:1.5b`. No paid API is required. A free OpenAI-compatible server can be swapped in later with `INDUS_LLM_PROVIDER=openai-compatible`.

Bots share one LLM lock, so inference never overlaps video renders. Idle bots are small Node processes.

## Services

| Folder | Port | Role |
| --- | --- | --- |
| indus-ops | 41731 | Login, overview, approval inbox, reverse proxy |
| indus-scheduler-bot | 41748 | Cron, intervals, one-offs, retries, pause-all |
| indus-commander-bot | 41749 | Morning plan. Cannot send, post, or deploy |
| indus-monitor-bot | 41741 | Uptime, TLS, host health |
| indus-seo-bot | 41742 | Sitemaps, metadata, IndexNow, drafts |
| indus-mailforge-bot | 41743 | MailForge stats and campaign drafts |
| indus-inquiries-bot | 41744 | IMAP and contact form. Sends only after approval |
| indus-leads-bot | 41745 | Public job leads and proposal drafts |
| indus-reports-bot | 41746 | Daily digest |
| indus-marketing-bot | 41747 | LinkedIn drafts, local video, organic plan |
| indus-security-bot | 41751 | VPS audit, allowlisted fixes after approval |
| indus-backup-bot | 41752 | Backups, checksums, restore drills |
| indus-devops-bot | 41753 | GitHub triage, allowlisted redeploy after approval |
| indus-content-bot | 41754 | Articles in the agency languages |
| indus-translator-bot | 41755 | hreflang pages, written only after approval |
| indus-crm-bot | 41756 | Pipeline and quote drafts |
| indus-invoice-bot | 41757 | PDF quotes and invoices. No payments |
| indus-support-bot | 41758 | Product chat widget, escalates to Inquiries |
| indus-competitor-bot | 41759 | robots.txt-respecting page watch |
| indus-analytics-bot | 41760 | First-party beacon. No raw IPs |
| indus-bot-core | — | Shared SDK |

Each folder is meant to be its own private GitHub repo under `mafzalkalwardev`. See the report in the latest commit message, or below, for push status.

## Local

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:41731 and create the owner. `npm run dev` uses the mock model so the board works without Ollama. Set `INDUS_LLM_PROVIDER=ollama` on the VPS.

## What you must supply

1. DNS `A`/`AAAA` for `ops.induswebagency.com` pointing at the VPS.
2. A certificate: `certbot certonly --webroot -w /var/www/certbot -d ops.induswebagency.com`, then `nginx -t && systemctl reload nginx`.
3. The setup token printed by `deploy/install-vps.sh`, used once to create the owner.
4. MailForge login (`email` / `password` on the MailForge bot) if you want live campaign stats. Base URL defaults to `http://127.0.0.1:5000`. Optional read-only `mongoUri`.
5. SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) for inquiry replies, monitor alerts, and digests. MailForge does not expose a generic send API.
6. IMAP host, user, and password on the Inquiries bot, plus the webhook secret. Point forms at `https://ops.induswebagency.com/api/hooks/contact` with header `X-Indus-Webhook-Secret` or field `secret`.
7. Per-site IndexNow keys on the SEO bot (`url | key` per line) when you want pings. The bot still audits without them.
8. Optional Google Search Console is not wired in this cut. IndexNow and on-page checks work without it.
9. Optional LinkedIn OAuth access token (`w_member_social`, and an organization if you grant it). Without it, approved posts export as copy. Client id and secret can be stored later. The bot never drives the LinkedIn website.
10. Optional X or Facebook tokens. Reddit is never posted automatically.
11. Optional Upwork token is not called in this cut. Leads come from Remotive and We Work Remotely RSS.
12. Optional GitHub token on the DevOps bot. Public repos work without it. Redeploy targets are `{ key, cwd, service }` and run only after approval.
13. systemd allowlists if Monitor or Security should restart or reload anything. The unit name is checked. `sudo` must be limited in `/etc/sudoers.d/indus`.
14. Backup paths, a restore root, and an optional Mongo URI. Offsite copy is a later rclone step. The backup script copies sqlite, `.env`, and nginx.
15. Analytics beacon: `<img src="https://ops.induswebagency.com/public/analytics/pixel.gif?s=mailforge&p=/">`. Support widget: `<script src="https://ops.induswebagency.com/public/support/widget.js" data-endpoint="https://ops.induswebagency.com/public/support"></script>`.

## Deploy

```bash
sudo bash deploy/install-vps.sh
```

The script installs Ollama and the model, creates the `indus` user, writes `/opt/indus/.env`, and enables one systemd unit per service.

Upgrades:

```bash
sudo rsync -a --exclude node_modules --exclude data --exclude .env ./ /opt/indus/
sudo -u indus bash -lc 'cd /opt/indus && npm install'
sudo systemctl restart 'indus-*'
```

Backups:

```bash
sudo bash deploy/backup.sh
```

Treat `/opt/indus/backups` as secret. Keep 14 days, then copy the directory off the box.

## Approval rule

Commander, Scheduler, and every bot may check, draft, render, and analyze on their own. Mail, campaigns, LinkedIn, social posts, quotes that leave the building, deploys, security fixes, translation publishes, and live restores stay in the inbox until you approve them. Reddit is export-only even after approval.
