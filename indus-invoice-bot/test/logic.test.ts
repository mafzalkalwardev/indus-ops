import { expect, it } from 'vitest';
import { buildPdf, lineTotal } from '../src/logic';

it('totals lines and writes a PDF without a payment link', () => {
  expect(lineTotal([{ qty: 2, price: 50 }, { qty: 1, price: 25 }])).toBe(125);
  const pdf = buildPdf('INV-0001', ['Total 125']);
  expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(pdf.toString()).not.toContain('stripe');
});
