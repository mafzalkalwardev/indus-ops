import { execFile } from 'node:child_process';
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './env';

export function clip(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

export function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split('\n').map((item) => item.trim()).filter(Boolean);
  return [];
}

export async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ ok: boolean; status: number; url: string; text: string; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: init.method || 'GET',
      headers: {
        'user-agent': 'INDUS-Ops/1.0 (+https://induswebagency.com)',
        accept: 'text/html,application/xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        ...init.headers,
      },
      body: init.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      text: clip(await response.text(), 500_000),
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      text: '',
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function execCommand(command: string, args: string[], timeoutMs = 8000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
      const err = error as NodeJS.ErrnoException & { code?: number | string } | null;
      const code = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

export async function sendMail(smtp: SmtpConfig, mail: { to: string; subject: string; text: string }): Promise<void> {
  if (!smtp.host || !smtp.from) throw new Error('SMTP is not configured.');
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
}

export function bearer(header: string | undefined): string {
  if (!header) return '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token || '' : '';
}
