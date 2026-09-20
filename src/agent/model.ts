/**
 * A provider-neutral chat client with tool calling. Gemini (Google AI Studio) and OpenRouter both expose the
 * OpenAI chat-completions shape, so one implementation covers them; another provider is one more implementation of
 * `ModelClient`. Nothing else in the agent knows which provider is behind it.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text, exactly as the model produced it (it may be malformed; the caller validates). */
  arguments: string;
  /**
   * Provider-specific data attached to this call that must be sent back unchanged on the next request. Gemini 3 puts an
   * encrypted "thought signature" here (`extra_content.google.thought_signature`) and answers 400 if the follow-up
   * request leaves it out. Opaque to us: never inspected or modified, only echoed.
   */
  extraContent?: unknown;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a single JSON object as the reply. */
  json?: boolean;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: Usage;
}

export interface ModelClient {
  /** "provider:model", e.g. "gemini:gemini-3.1-flash-lite". Used in logs and reports. */
  readonly id: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

/** An HTTP failure from the provider. 429 usually means a rate limit or a spent free-tier quota. */
export class ModelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ModelHttpError';
  }
}

/** Blocks until it is safe to send one more request. */
export interface RateLimiter {
  acquire(): Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A sliding-window limiter: at most `perMinute` requests in any 60 seconds. Callers queue in order, so several callers
 * that share one provider quota can share one limiter. Waiting is cheaper than a 429, which still burns a request.
 */
export function createRateLimiter(
  perMinute: number,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = { now: Date.now, sleep: defaultSleep },
): RateLimiter {
  if (!Number.isInteger(perMinute) || perMinute < 1) throw new Error(`requests per minute must be a positive integer, got ${perMinute}`);
  const stamps: number[] = [];
  let queue: Promise<void> = Promise.resolve();
  return {
    acquire() {
      const turn = queue.then(async () => {
        for (;;) {
          const now = clock.now();
          while (stamps.length > 0 && now - stamps[0] >= 60_000) stamps.shift();
          if (stamps.length < perMinute) {
            stamps.push(now);
            return;
          }
          await clock.sleep(stamps[0] + 60_000 - now + 50);
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

export interface OpenAiCompatOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Called before every HTTP attempt, retries included. */
  limiter?: RateLimiter;
  fetch?: typeof fetch;
  /** Extra attempts after the first, for 429, 5xx and network errors. */
  maxRetries?: number;
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;

/** How long the provider says to wait, from its error text ("Please retry in 47.9s" or a "retryDelay": "48s" detail). */
export function retryHintMs(bodyText: string): number | null {
  const m = /retry in ([\d.]+)\s*s/i.exec(bodyText) ?? /"retryDelay"\s*:\s*"([\d.]+)s"/i.exec(bodyText);
  const seconds = m ? Number(m[1]) : NaN;
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

/** Prefers the Retry-After header, then the provider's own hint, then exponential backoff. */
function retryDelayMs(attempt: number, retryAfter: string | null, hintMs: number | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_MAX_MS);
  if (hintMs !== null) return hintMs + 500; // a little slack, so we do not land a hair early and get 429 again
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** Pulls the provider's own message out of an error body. Gemini returns an array, OpenAI an object. */
function errorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = (first as { error?: { message?: string } } | undefined)?.error?.message;
    if (message) return message;
  } catch {
    // not JSON: fall through to the raw text
  }
  return bodyText.slice(0, 300);
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.content,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.arguments },
              ...(c.extraContent !== undefined ? { extra_content: c.extraContent } : {}),
            })),
          }
        : {}),
    };
  }
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content };
  return { role: m.role, content: m.content };
}

export function createOpenAiCompatClient(options: OpenAiCompatOptions): ModelClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 3;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    id: options.id,
    async chat(request) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: request.messages.map(toWireMessage),
        temperature: request.temperature ?? 0.2,
      };
      if (request.maxTokens) body.max_tokens = request.maxTokens;
      if (request.json) body.response_format = { type: 'json_object' };
      if (request.tools?.length) {
        body.tools = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
      const payload = JSON.stringify(body);

      let lastError: Error = new Error('request was never attempted');
      let quotaHits = 0;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let retryAfter: string | null = null;
        let hintMs: number | null = null;
        let fatal = false;
        try {
          await options.limiter?.acquire();
          const res = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
            body: payload,
            signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
          });
          const text = await res.text();
          if (res.ok) return parseResponse(text);

          retryAfter = res.headers.get('retry-after');
          hintMs = retryHintMs(text);
          lastError = new ModelHttpError(`${options.id} returned ${res.status}: ${errorMessage(text)}`, res.status);
          // A quota message that survives one full wait-and-retry is not a rate-limit blip: the quota is spent (often a
          // daily one, whatever "retry in Ns" suggests), and more waiting only stalls the caller for minutes.
          if (res.status === 429 && /quota/i.test(text)) quotaHits++;
          // A 4xx we caused cannot be fixed by retrying, and neither can a wait the provider says is over a minute.
          fatal = (res.status !== 429 && res.status < 500) || (hintMs !== null && hintMs > RETRY_MAX_MS) || quotaHits >= 2;
          if (fatal) throw lastError;
        } catch (err) {
          if (fatal) throw err;
          if (!(err instanceof ModelHttpError)) lastError = err instanceof Error ? err : new Error(String(err)); // network error or timeout
        }
        if (attempt < maxRetries) await sleep(retryDelayMs(attempt, retryAfter, hintMs));
      }
      throw lastError;
    },
  };
}

interface WireResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; tool_calls?: Array<{ id?: string; extra_content?: unknown; function?: { name?: string; arguments?: unknown } }> };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function parseResponse(text: string): ChatResponse {
  let data: WireResponse;
  try {
    data = JSON.parse(text) as WireResponse;
  } catch {
    throw new Error(`model returned a non-JSON response: ${text.slice(0, 200)}`);
  }
  const choice = data.choices?.[0];
  if (!choice?.message) throw new Error(`model response had no choices: ${text.slice(0, 200)}`);

  const toolCalls = (choice.message.tool_calls ?? []).map((c, i) => ({
    // Some providers return an empty id; the conversation still needs a stable one to pair results with calls.
    id: c.id || `call_${i}`,
    name: c.function?.name ?? '',
    arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
    ...(c.extra_content !== undefined ? { extraContent: c.extra_content } : {}),
  }));

  return {
    content: choice.message.content ?? null,
    toolCalls,
    finishReason: choice.finish_reason ?? 'unknown',
    usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
  };
}

type Env = Record<string, string | undefined>;

// `defaultRpm` is a conservative client-side pace, not a claim about the provider: Gemini's free tier has reported small
// per-minute and per-day limits, so we stay well under. Override with GEO_<PROVIDER>_RPM ("off" disables).
const PROVIDERS: Record<string, { baseUrl: string; keyVar: string; defaultRpm?: number }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyVar: 'GEMINI_API_KEY', defaultRpm: 15 },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyVar: 'OPENROUTER_API_KEY' },
};

// One limiter per provider:model, shared by every client for it: the provider's quota is per model, so everything that
// uses the same model must draw from the same budget.
const limiters = new Map<string, { rpm: number; limiter: RateLimiter }>();

function limiterFor(spec: string, rpm: number): RateLimiter {
  const existing = limiters.get(spec);
  if (existing?.rpm === rpm) return existing.limiter;
  const entry = { rpm, limiter: createRateLimiter(rpm) };
  limiters.set(spec, entry);
  return entry.limiter;
}

/** "gemini:gemini-3.1-flash-lite" or "openrouter:google/gemma-4-31b-it:free": the first colon separates the provider. */
export function parseModelSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf(':');
  const provider = i > 0 ? spec.slice(0, i) : '';
  const model = i > 0 ? spec.slice(i + 1) : '';
  if (!PROVIDERS[provider] || !model) {
    throw new Error(`invalid model "${spec}": expected "<provider>:<model>" with provider one of ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return { provider, model };
}

/** The pace configured for a model, or null for unlimited. */
export function configuredRpm(spec: string, env: Env = process.env): number | null {
  const { provider } = parseModelSpec(spec);
  const raw = env[`GEO_${provider.toUpperCase()}_RPM`]?.trim().toLowerCase();
  if (raw === 'off' || raw === '0') return null;
  if (raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`GEO_${provider.toUpperCase()}_RPM must be a positive integer or "off", got "${raw}"`);
    return n;
  }
  return PROVIDERS[provider].defaultRpm ?? null;
}

export function createModelClient(spec: string, env: Env = process.env, overrides: Partial<OpenAiCompatOptions> = {}): ModelClient {
  const { provider, model } = parseModelSpec(spec);
  const { baseUrl, keyVar } = PROVIDERS[provider];
  const apiKey = env[keyVar]?.trim();
  if (!apiKey) throw new Error(`${keyVar} is required to use ${spec}`);
  const rpm = configuredRpm(spec, env);
  return createOpenAiCompatClient({ id: spec, baseUrl, apiKey, model, ...(rpm ? { limiter: limiterFor(spec, rpm) } : {}), ...overrides });
}

/** The model the agent uses unless told otherwise: GEO_AGENT_MODEL (first entry if comma-separated), else this default. */
export const DEFAULT_AGENT_MODEL = 'gemini:gemini-3.1-flash-lite';
export const agentModelSpec = (env: Env = process.env) => env.GEO_AGENT_MODEL?.split(',')[0]?.trim() || DEFAULT_AGENT_MODEL;
