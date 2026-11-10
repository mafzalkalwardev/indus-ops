export function lineTotal(lines: { qty: number; price: number }[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.price, 0);
}

export function buildPdf(title: string, lines: string[]): Buffer {
  const text = [title, ...lines].map((line, index) => `BT /F1 12 Tf 48 ${740 - index * 18} Td (${escapePdf(line)}) Tj ET`).join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n`,
    `4 0 obj << /Length ${text.length} >> stream\n${text}\nendstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

function escapePdf(value: string): string {
  return value.replace(/[()\\]/g, (char) => `\\${char}`);
}

import type { TaskContext, TaskResult } from '@indus/bot-core';

export async function run(ctx: TaskContext): Promise<TaskResult> {
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY, kind TEXT, number TEXT, client TEXT, total INTEGER, status TEXT, created_at TEXT
  )`);
  if (ctx.task === 'instruct') return { summary: 'Invoices are recorded here. This bot does not take payment.' };
  const rows = ctx.db.prepare(`SELECT status, total FROM docs`).all() as { status: string; total: number }[];
  const open = rows.filter((row) => row.status !== 'paid').reduce((sum, row) => sum + row.total, 0);
  const paid = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.total, 0);
  return { summary: `Open ${open}. Paid ${paid}. No payment processor is connected.`, details: { open, paid, count: rows.length } };
}

export function createDocument(db: TaskContext['db'], input: { kind: 'quote' | 'invoice'; client: string; lines: { qty: number; price: number; label: string }[] }): { number: string; pdf: Buffer } {
  const total = lineTotal(input.lines);
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM docs`).get() as { n: number }).n + 1;
  const number = `${input.kind === 'quote' ? 'Q' : 'INV'}-${String(count).padStart(4, '0')}`;
  db.prepare(`INSERT INTO docs (kind, number, client, total, status, created_at) VALUES (?, ?, ?, ?, 'unpaid', ?)`).run(input.kind, number, input.client, total, new Date().toISOString());
  const pdf = buildPdf(`${number} · ${input.client}`, [`Total ${total}`, ...input.lines.map((line) => `${line.qty} x ${line.label} @ ${line.price}`)]);
  return { number, pdf };
}
