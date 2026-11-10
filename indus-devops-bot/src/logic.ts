import { execCommand, fetchText, type TaskContext, type TaskResult } from '@indus/bot-core';

const UNIT = /^[a-zA-Z0-9][a-zA-Z0-9:@._-]{0,80}$/;
const BRANCH = /^[\w.\-/]+$/;

export function summarizeRepos(repos: { name: string; open_issues_count?: number; pushed_at?: string }[]): string {
  return repos.slice(0, 8).map((repo) => `${repo.name} (${repo.open_issues_count || 0} open issues)`).join(', ');
}

export async function run(ctx: TaskContext): Promise<TaskResult> {
  if (ctx.task === 'instruct') {
    const reply = await ctx.llm('You triage GitHub for INDUS. Do not claim you deployed.', String(ctx.payload.message || ''));
    return { summary: reply.text.slice(0, 280) };
  }
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  if (ctx.settings.token) headers.authorization = `Bearer ${ctx.settings.token}`;
  const user = String(ctx.settings.user || 'mafzalkalwardev');
  const listed = await fetchText(`https://api.github.com/users/${user}/repos?per_page=20&sort=updated`, ctx.fetch, 8000, { headers });
  const repos = listed.ok ? JSON.parse(listed.text) as { name: string; full_name: string; open_issues_count?: number }[] : [];
  const summary = repos.length ? summarizeRepos(repos) : `GitHub list failed (${listed.status || listed.error}).`;
  const targets = (Array.isArray(ctx.settings.targets) ? ctx.settings.targets : []) as { key?: string; repo?: string }[];
  if (targets[0]?.key) {
    ctx.propose({
      type: 'deploy',
      title: `Redeploy ${targets[0].key}?`,
      summary: 'Approval runs git pull --ff-only and systemctl restart for that allowlisted app only.',
      body: summary,
      payload: { key: targets[0].key, branch: 'main' },
    });
  }
  return { summary, details: { count: repos.length } };
}

export async function resolve(item: { payload: Record<string, unknown> }, input: Record<string, unknown>, deps: { settings: () => Record<string, unknown> }) {
  const key = String(item.payload.key || '');
  const branch = String(input.branch || item.payload.branch || 'main');
  const targets = (deps.settings().targets || []) as { key: string; cwd: string; service: string }[];
  const target = targets.find((itemTarget) => itemTarget.key === key);
  if (!target) throw new Error('That deploy target is not allowlisted.');
  if (!BRANCH.test(branch) || !UNIT.test(target.service) || target.cwd.includes('..')) throw new Error('Branch, service, or path was rejected.');
  const pull = await execCommand('git', ['-C', target.cwd, 'pull', '--ff-only', 'origin', branch], 60_000);
  if (pull.code !== 0) throw new Error(pull.stderr || 'git pull failed.');
  const restart = await execCommand('sudo', ['-n', 'systemctl', 'restart', target.service]);
  if (restart.code !== 0) throw new Error(restart.stderr || 'restart failed.');
  return { deployed: key, branch };
}
