import { sanitizePlan, type PlanAction } from '@indus/bot-core';

export const ALLOWED: Record<string, string[]> = {
  monitor: ['check', 'instruct'],
  seo: ['check', 'instruct'],
  mailforge: ['check', 'instruct'],
  inquiries: ['check', 'instruct'],
  leads: ['check', 'instruct'],
  reports: ['digest', 'instruct'],
  marketing: ['draft', 'render', 'instruct'],
  security: ['audit', 'instruct'],
  backup: ['backup', 'drill', 'instruct'],
  devops: ['triage', 'instruct'],
  content: ['draft', 'instruct'],
  translator: ['translate', 'instruct'],
  crm: ['sync', 'instruct'],
  invoice: ['report', 'instruct'],
  support: ['refresh-docs', 'instruct'],
  competitor: ['scan', 'instruct'],
  analytics: ['rollup', 'instruct'],
  scheduler: ['tick', 'instruct'],
  commander: ['plan', 'summary', 'instruct'],
};

export function fallbackPlan(known: string[]): PlanAction[] {
  return [
    { botId: 'monitor', task: 'check', reason: 'Confirm the sites before asking anyone to write.' },
    { botId: 'security', task: 'audit', reason: 'Read the box before changing it.' },
    { botId: 'inquiries', task: 'check', reason: 'Draft replies. Nothing sends.' },
    { botId: 'reports', task: 'digest', reason: 'Summarize whatever the other bots recorded.' },
  ].filter((action) => known.includes(action.botId));
}

export function preparePlan(raw: unknown, known: string[]): { accepted: PlanAction[]; rejected: { action: PlanAction; reason: string }[]; reasoning: string } {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const reasoning = String(record.reasoning || 'The model did not explain itself, so the safe fallback is in charge.');
  const actions = Array.isArray(record.actions) ? record.actions as PlanAction[] : [];
  const knownAllowed = Object.fromEntries(Object.entries(ALLOWED).filter(([bot]) => known.includes(bot) || bot === 'commander'));
  const filtered = sanitizePlan(actions, knownAllowed);
  if (!filtered.accepted.length) {
    return { accepted: fallbackPlan(known), rejected: filtered.rejected, reasoning: `${reasoning} No safe model actions survived, so the standing morning checks are queued.` };
  }
  return { ...filtered, reasoning };
}
