# @indus/bot-core

Shared SDK for the INDUS bots. It is a library, not a service, so it has no systemd unit of its own.

What it owns:

- One SQLite lock in `INDUS_SHARED_DIR` so every bot shares a single local LLM call at a time.
- Ollama and OpenAI-compatible clients, plus a mock used by tests.
- Bot registration, SSO verification, approvals, the job queue, and the bot UI shell.
- The commander's allow-list. Tasks named publish, send, deploy, approve, restore, or apply-fix are rejected.

```bash
npm install
npm test
```

Other repos depend on this folder with `"@indus/bot-core": "file:../indus-bot-core"`. On the VPS they sit side by side under `/opt/indus`.
