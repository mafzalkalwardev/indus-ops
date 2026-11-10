export const APP_VERSION = '1.0.0';

export type FieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'bool' | 'lines';
  secret?: boolean;
  help?: string;
};

export const PRODUCT_SITES = [
  'https://mailforge.induswebagency.com',
  'https://routelix.induswebagency.com',
  'https://tapvio.induswebagency.com',
  'https://inkcadence.induswebagency.com',
  'https://articlepulse.induswebagency.com',
  'https://phoneverifier.induswebagency.com',
  'https://carriersource.induswebagency.com',
  'https://pakoption.induswebagency.com',
  'https://laneora.induswebagency.com',
  'https://demo.induswebagency.com',
] as const;

export const AGENCY_LANGUAGES = [
  { code: 'en', name: 'English', hreflang: 'en' },
  { code: 'es', name: 'Spanish', hreflang: 'es' },
  { code: 'fr', name: 'French', hreflang: 'fr' },
  { code: 'ur', name: 'Urdu', hreflang: 'ur' },
  { code: 'pa', name: 'Punjabi', hreflang: 'pa' },
  { code: 'sd', name: 'Sindhi', hreflang: 'sd' },
  { code: 'ht', name: 'Haitian Creole', hreflang: 'ht' },
] as const;

export type PublicApprovalType =
  | 'inquiry_reply'
  | 'mailforge_campaign'
  | 'linkedin_post'
  | 'blog_post'
  | 'social_post'
  | 'lead_proposal'
  | 'directory_copy'
  | 'quote'
  | 'invoice_send'
  | 'deploy'
  | 'security_fix'
  | 'restore'
  | 'translation_publish';

export const PUBLIC_APPROVAL_TYPES: PublicApprovalType[] = [
  'inquiry_reply',
  'mailforge_campaign',
  'linkedin_post',
  'blog_post',
  'social_post',
  'lead_proposal',
  'directory_copy',
  'quote',
  'invoice_send',
  'deploy',
  'security_fix',
  'restore',
  'translation_publish',
];

export type PlanAction = {
  botId: string;
  task: string;
  reason: string;
  payload?: Record<string, unknown>;
};

const BLOCKED_TASKS = new Set([
  'publish', 'publish-blog', 'approve', 'send', 'deploy', 'restore', 'apply-fix', 'post',
]);

const BLOCKED_PAYLOAD_KEYS = /^(approve|send|publish|shell|command|argv)$/i;

export function sanitizePlan(
  actions: PlanAction[],
  allowed: Record<string, string[]>,
): { accepted: PlanAction[]; rejected: { action: PlanAction; reason: string }[] } {
  const accepted: PlanAction[] = [];
  const rejected: { action: PlanAction; reason: string }[] = [];
  for (const action of actions) {
    const task = String(action.task || '');
    const botId = String(action.botId || '');
    const permit = allowed[botId];
    if (!permit) {
      rejected.push({ action, reason: `Unknown bot ${botId}.` });
      continue;
    }
    if (BLOCKED_TASKS.has(task) || !permit.includes(task)) {
      rejected.push({ action, reason: `${botId} cannot be told to ${task}. That stays behind an approval.` });
      continue;
    }
    const payload = action.payload || {};
    const badKey = Object.keys(payload).find((key) => BLOCKED_PAYLOAD_KEYS.test(key));
    if (badKey) {
      rejected.push({ action, reason: `Payload key ${badKey} is not allowed on an automatic task.` });
      continue;
    }
    accepted.push({ botId, task, reason: String(action.reason || 'No reason given.'), payload });
  }
  return { accepted, rejected };
}

export function productName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/\.induswebagency\.com$/, '');
    if (host === 'demo') return 'INDUS Demo';
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return url;
  }
}
