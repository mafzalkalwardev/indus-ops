import { extractJson, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';
import { productName } from '@indus/bot-core';

export const FORMATS = ['launch', 'feature', 'howto', 'problem', 'carousel', 'showcase'] as const;

export function withUtm(url: string, source: string, content: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', source);
  parsed.searchParams.set('utm_medium', 'organic');
  parsed.searchParams.set('utm_campaign', 'indus-ops');
  parsed.searchParams.set('utm_content', content);
  return parsed.toString();
}

export function deliveryMode(channel: string, opts: { linkedin: boolean; x: boolean; facebook: boolean }): 'api' | 'export' {
  if (channel === 'reddit' || channel === 'directory') return 'export';
  if (channel === 'linkedin') return opts.linkedin ? 'api' : 'export';
  if (channel === 'x') return opts.x ? 'api' : 'export';
  if (channel === 'facebook') return opts.facebook ? 'api' : 'export';
  return 'export';
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You are the INDUS marketing bot. Do not claim a post was published.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  if (ctx.task === 'render') {
    const { renderReel } = await import('./video');
    const url = String(ctx.payload.url || 'https://mailforge.induswebagency.com');
    const file = await renderReel({
      workDir: ctx.dataDir,
      title: productName(url),
      script: String(ctx.payload.script || 'This product runs on your own server. You keep the data. Open the page and watch the first workflow.'),
      aspect: '9:16',
    });
    ctx.db.exec(`CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY, product TEXT, file TEXT, created_at TEXT)`);
    ctx.db.prepare(`INSERT INTO media (product, file, created_at) VALUES (?, ?, ?)`).run(url, file.file, ctx.now.toISOString());
    return { summary: `Rendered ${file.file}`, details: file };
  }
  const products = (Array.isArray(ctx.settings.products) ? ctx.settings.products : []) as string[];
  const url = products[0] || 'https://mailforge.induswebagency.com';
  const page = await fetchText(url, ctx.fetch, 8000);
  const llms = await fetchText(new URL('/llms.txt', url).toString(), ctx.fetch, 8000);
  const source = `${llms.text || page.text}`.slice(0, 2500);
  const format = FORMATS[ctx.now.getUTCDay() % FORMATS.length];
  const draft = await ctx.llm('Write a LinkedIn post as JSON with post and hashtags. This is a marketing draft. Use {{link}}.', `Format: ${format}\nProduct: ${productName(url)}\nSource:\n${source}`);
  let post = `${productName(url)} keeps the work on your own server.\n\n{{link}}`;
  let tags = ['#INDUS', `#${productName(url).replace(/\s+/g, '')}`];
  try {
    const parsed = extractJson(draft.text) as { post?: string; hashtags?: string[] };
    post = parsed.post || post;
    if (parsed.hashtags?.length) tags = parsed.hashtags;
  } catch { /* fallback copy */ }
  const link = withUtm(url, 'linkedin', format);
  const body = `${post.replaceAll('{{link}}', link)}\n\n${link}\n\n${tags.join(' ')}`;
  const linkedin = Boolean(ctx.settings.linkedinToken);
  ctx.propose({
    type: 'linkedin_post',
    title: `${productName(url)} · ${format}`,
    summary: deliveryMode('linkedin', { linkedin, x: false, facebook: false }) === 'api' ? 'Will post through the LinkedIn API after approval.' : 'No LinkedIn token. Approval exports copy for you to paste.',
    body,
    payload: { url, format, channel: 'linkedin' },
  });
  const social = await ctx.llm('Write social drafts JSON with x, facebook, and reddit. These are social drafts for manual posting.', source.slice(0, 800));
  let pack = { x: body.slice(0, 240), facebook: body.slice(0, 400), reddit: 'Notes from running this ourselves.' };
  try { pack = { ...pack, ...(extractJson(social.text) as typeof pack) }; } catch { /* keep */ }
  ctx.propose({ type: 'social_post', title: `${productName(url)} social pack`, summary: 'X, Facebook, and Reddit stay export-only unless an official token is saved. Reddit is never auto-posted.', body: `X: ${pack.x}\n\nFacebook: ${pack.facebook}\n\nReddit: ${pack.reddit}`, payload: { url, channel: 'reddit' } });
  return { summary: `Drafted a ${format} post for ${productName(url)}. Nothing was published.` };
}

export async function resolve(item: { type: string; body: string; payload: Record<string, unknown> }, input: Record<string, unknown>, deps: { settings: () => Record<string, unknown> }) {
  const settings = deps.settings();
  const channel = String(item.payload.channel || '');
  if (channel === 'reddit' || item.type === 'social_post') return { exported: true, text: item.body, note: 'Saved as copy. Reddit is never posted by this bot.' };
  if (!settings.linkedinToken) return { exported: true, text: item.body, note: 'No LinkedIn credentials. Copy is ready to paste.' };
  const when = String(input.scheduledAt || '');
  if (!when) return { exported: true, text: item.body, note: 'Add a time to schedule the official LinkedIn post. Nothing was sent.' };
  return { scheduled: true, at: when, text: item.body, note: 'Credentials exist. A later scheduler publish step would call the official Posts API. This build records the approved time and does not call LinkedIn until LINKEDIN_PUBLISH=1.' };
}
