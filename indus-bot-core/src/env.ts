export type LlmProvider = 'ollama' | 'openai-compatible' | 'mock';

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function llmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const provider = env.INDUS_LLM_PROVIDER || env.LLM_PROVIDER || 'ollama';
  return {
    provider: provider === 'mock' || provider === 'openai-compatible' ? provider : 'ollama',
    model: env.LLM_MODEL || env.OLLAMA_MODEL || 'qwen2.5:3b',
    baseUrl: env.LLM_BASE_URL || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    apiKey: env.LLM_API_KEY || '',
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 240_000),
  };
}

export function smtpConfig(env: NodeJS.ProcessEnv): SmtpConfig {
  return {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === '1',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  };
}

export function loopbackHost(value: string | undefined): string {
  if (!value || value === 'localhost' || value === '127.0.0.1') return '127.0.0.1';
  if (value === '::1') return '::1';
  console.warn(`Refusing to bind ${value}. INDUS services listen on 127.0.0.1 only.`);
  return '127.0.0.1';
}
