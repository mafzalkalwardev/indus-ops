import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AGENCY_LANGUAGES, extractJson, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

export function hreflangBlock(canonical: string, codes: { hreflang: string }[]): string {
  const links = codes.map((code) => `<link rel="alternate" hreflang="${code.hreflang}" href="${canonical}?lang=${code.hreflang}">`);
  links.push(`<link rel="alternate" hreflang="x-default" href="${canonical}">`);
  return links.join('\n');
}

export function localizedHtml(input: { title: string; body: string; canonical: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>\n${hreflangBlock(input.canonical, [...AGENCY_LANGUAGES])}\n</head><body><main><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.body)}</p></main></body></html>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] || char));
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You translate for INDUS. Do not claim a page was published.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const url = String((Array.isArray(ctx.settings.pages) ? ctx.settings.pages[0] : '') || 'https://mailforge.induswebagency.com');
  const page = await fetchText(url, ctx.fetch, 8000);
  const language = AGENCY_LANGUAGES.find((item) => item.code === 'es') || AGENCY_LANGUAGES[1];
  const reply = await ctx.llm('Return JSON with title and translation. This is a translation draft.', `Translate the gist of this page into ${language.name}:\n${page.text.slice(0, 1500)}`);
  let title = `${language.name} draft`;
  let body = 'Borrador para revision.';
  try {
    const parsed = extractJson(reply.text) as { title?: string; translation?: string };
    title = parsed.title || title;
    body = parsed.translation || body;
  } catch { /* fallback */ }
  const html = localizedHtml({ title, body, canonical: url });
  ctx.propose({ type: 'translation_publish', title, summary: `${language.name} page for ${url}`, body: html, payload: { url, language: language.code } });
  return { summary: `Drafted a ${language.name} page. It is not on disk until you approve.` };
}

export async function resolve(item: { body: string; payload: Record<string, unknown> }, _input: Record<string, unknown>, deps: { settings: () => Record<string, unknown> }) {
  const dir = String(deps.settings().publishDir || '');
  if (!dir || !dir.startsWith('/') || dir.includes('..')) return { exported: true, html: item.body, note: 'No publish directory. The HTML is saved on the approval.' };
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${item.payload.language || 'es'}.html`);
  writeFileSync(file, item.body);
  return { published: file };
}
