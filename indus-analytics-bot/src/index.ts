import { createBotService } from '@indus/bot-core';
import { ensure, run, visitorKey } from './logic';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const svc = createBotService({
  id: 'analytics',
  name: 'Analytics',
  description: 'A first-party beacon and optional nginx log rollup. Raw IPs are not stored.',
  accent: '#9ec4a0',
  defaultPort: 41760,
  capabilities: ['analytics'],
  defaultSettings: { nginxLog: '' },
  fields: [{ key: 'nginxLog', label: 'Optional nginx access log path', type: 'text' }],
  desired: [{ key: 'rollup', task: 'rollup', cron: '10 * * * *', group: 'default' }],
  autoTask: 'rollup',
  publicRoutes: (app, deps) => {
    ensure(deps.db);
    app.get('/pixel.gif', (req, res) => {
      const site = String(req.query.s || 'site').slice(0, 80);
      const pagePath = String(req.query.p || '/').slice(0, 200);
      const referrer = String(req.query.r || '').slice(0, 200);
      const day = new Date().toISOString().slice(0, 10);
      const salt = deps.env.INDUS_ENCRYPTION_KEY || 'indus-analytics';
      const visitor = visitorKey(req.ip || '', String(req.get('user-agent') || ''), day, salt);
      deps.db.prepare(`INSERT INTO hits (site, path, referrer, day, visitor, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(site, pagePath, referrer, day, visitor, new Date().toISOString());
      res.setHeader('cache-control', 'no-store');
      res.type('gif').send(GIF);
    });
  },
  collect: (deps) => {
    ensure(deps.db);
    const day = new Date().toISOString().slice(0, 10);
    return { today: deps.db.prepare(`SELECT COUNT(*) AS n FROM hits WHERE day = ?`).get(day) };
  },
  runTask: run,
});

ensure(svc.db);
svc.start().catch((error) => { console.error(error); process.exit(1); });
