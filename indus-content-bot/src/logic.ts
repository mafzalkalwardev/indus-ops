import { AGENCY_LANGUAGES, extractJson, type TaskContext, type TaskResult } from '@indus/bot-core';

export function brief(product: string, language: string): string {
  return `SEO brief for ${product} in ${language}: one job-to-be-done headline, a 150 character description, and three internal links back to the product.`;
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You draft INDUS articles. Do not claim one was published.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const products = (Array.isArray(ctx.settings.products) ? ctx.settings.products : ['https://mailforge.induswebagency.com']) as string[];
  const product = products[ctx.now.getUTCDate() % products.length];
  const language = AGENCY_LANGUAGES[ctx.now.getUTCDay() % AGENCY_LANGUAGES.length];
  const reply = await ctx.llm('Write article JSON with title, description, and body. This is an article draft.', `${brief(product, language.name)}\nLanguage: ${language.name}`);
  let article = { title: `${language.name} draft`, description: brief(product, language.name), body: 'Lead with the job. Link back to the product.' };
  try { article = { ...article, ...(extractJson(reply.text) as typeof article) }; } catch { /* fallback */ }
  ctx.propose({ type: 'blog_post', title: article.title, summary: `${language.name} · ${product}`, body: article.body, payload: { product, language: language.code, description: article.description } });
  const headers = { authorization: `Bearer ${process.env.INDUS_BOT_TOKEN || 'dev-bot-token'}`, 'content-type': 'application/json' };
  for (const bot of ['seo', 'marketing']) {
    const base = process.env[`INDUS_${bot.toUpperCase()}_URL`];
    if (!base) continue;
    await fetch(new URL('/api/internal/ingest', base), { method: 'POST', headers, body: JSON.stringify({ from: 'content', type: 'blog_post', title: article.title, summary: article.description, body: article.body, payload: { product, language: language.code } }) }).catch(() => undefined);
  }
  return { summary: `Drafted a ${language.name} article for ${product}. It is waiting for approval.` };
}
