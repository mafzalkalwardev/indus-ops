export type CronField = { any: true } | { any: false; values: Set<number> };

export type CronExpr = {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  source: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Use a 5-field cron expression in UTC: minute hour day month weekday.');
  return {
    minute: parseField(parts[0], 0, 59, {}),
    hour: parseField(parts[1], 0, 23, {}),
    dom: parseField(parts[2], 1, 31, {}),
    month: parseField(parts[3], 1, 12, MONTHS),
    dow: parseField(parts[4], 0, 7, DAYS),
    source: expr.trim(),
  };
}

export function cronMatches(expr: CronExpr, date: Date): boolean {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  let dow = date.getUTCDay();
  if (!fieldHas(expr.minute, minute) || !fieldHas(expr.hour, hour) || !fieldHas(expr.month, month)) return false;
  const domOk = expr.dom.any || fieldHas(expr.dom, dom);
  const dowOk = expr.dow.any || fieldHas(expr.dow, dow) || (dow === 0 && fieldHas(expr.dow, 7));
  if (expr.dom.any && expr.dow.any) return true;
  if (expr.dom.any) return dowOk;
  if (expr.dow.any) return domOk;
  // Classic cron: when both day-of-month and weekday are restricted, either match is enough.
  return domOk || dowOk;
}

export function nextCron(expr: string | CronExpr, from: Date): Date {
  const parsed = typeof expr === 'string' ? parseCron(expr) : expr;
  let cursor = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    from.getUTCHours(),
    from.getUTCMinutes(),
    0,
    0,
  );
  if (cursor <= from.getTime()) cursor += 60_000;
  const limit = cursor + 366 * 24 * 60 * 60_000;
  while (cursor <= limit) {
    const date = new Date(cursor);
    if (cronMatches(parsed, date)) return date;
    cursor += 60_000;
  }
  throw new Error(`No upcoming run for "${parsed.source}".`);
}

function parseField(raw: string, min: number, max: number, names: Record<string, number>): CronField {
  if (raw === '*') return { any: true };
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step in "${raw}".`);
    let start = min;
    let end = max;
    let single = false;
    if (range !== '*') {
      const [aRaw, bRaw] = range.split('-');
      start = token(aRaw, names);
      end = bRaw === undefined ? start : token(bRaw, names);
      single = bRaw === undefined && stepRaw === undefined;
    }
    if (start < min || end > max || start > end) throw new Error(`Cron value "${part}" is outside ${min}-${max}.`);
    if (single) {
      values.add(normalize(start, max));
      continue;
    }
    for (let n = start; n <= end; n += step) values.add(normalize(n, max));
  }
  if (!values.size) throw new Error(`Cron field "${raw}" is empty.`);
  return { any: false, values };
}

function normalize(value: number, max: number): number {
  return value === 7 && max === 7 ? 0 : value;
}

function token(value: string, names: Record<string, number>): number {
  const named = names[value.toLowerCase()];
  if (named !== undefined) return named;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid cron token "${value}".`);
  return Number(value);
}

function fieldHas(field: CronField, value: number): boolean {
  return field.any || field.values.has(value);
}

export function assertCron(expr: string): string {
  return parseCron(expr).source;
}
