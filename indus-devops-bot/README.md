# @indus/devops-bot

GitHub triage and approved redeploys.

This service binds to 127.0.0.1:41753. The hub is the only public site. It reverse-proxies the UI at `/bots/devops/` after login.

```bash
npm install
cp .env.example .env
npm test
npm start
```

The shared SDK is `@indus/bot-core` (sibling folder, or `github:mafzalkalwardev/indus-bot-core` once that private repo exists). Secrets stay in `.env`. The model is whatever `LLM_MODEL` points at in Ollama. Nothing public is sent from this process without an approval recorded by the hub.

Idle cost is one small Node process. LLM calls take the shared lock in `INDUS_SHARED_DIR` so only one model run happens on the box.
