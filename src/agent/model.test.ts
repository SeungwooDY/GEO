import { describe, expect, it, vi } from 'vitest';
import {
  agentModelSpec,
  configuredRpm,
  createModelClient,
  createOpenAiCompatClient,
  createRateLimiter,
  DEFAULT_AGENT_MODEL,
  ModelHttpError,
  parseModelSpec,
  retryHintMs,
} from './model.js';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const reply = (message: Record<string, unknown>) => ok({ choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  return {
    sleeps,
    client: createOpenAiCompatClient({
      id: 'test:m',
      baseUrl: 'https://api.example.test/v1/',
      apiKey: 'sekret-key',
      model: 'm',
      fetch: fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
      ...over,
    }),
  };
}

describe('the OpenAI-compatible client', () => {
  it('sends the request in the OpenAI shape and parses text and usage', async () => {
    const fetchMock = vi.fn(async () => reply({ content: 'hi' }));
    const { client: c } = client(fetchMock as unknown as typeof fetch);

    const res = await c.chat({
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }],
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      maxTokens: 50,
      json: true,
    });

    expect(res).toEqual({ content: 'hi', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sekret-key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'm',
      max_tokens: 50,
      response_format: { type: 'json_object' },
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } }],
    });
  });

  it('round-trips tool calls, including a provider that omits call ids', async () => {
    const fetchMock = vi.fn(async () =>
      reply({ content: null, tool_calls: [{ id: '', function: { name: 'read_file', arguments: { path: 'a' } } }, { id: 'x', function: { name: 'search', arguments: '{"pattern":"p"}' } }] }),
    );
    const { client: c } = client(fetchMock as unknown as typeof fetch);

    const res = await c.chat({ messages: [{ role: 'user', content: 'go' }] });
    expect(res.toolCalls).toEqual([
      { id: 'call_0', name: 'read_file', arguments: '{"path":"a"}' },
      { id: 'x', name: 'search', arguments: '{"pattern":"p"}' },
    ]);

    await c.chat({
      messages: [
        { role: 'assistant', content: null, toolCalls: res.toolCalls },
        { role: 'tool', toolCallId: 'call_0', name: 'read_file', content: 'file text' },
      ],
    });
    const sent = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages;
    expect(sent[0].tool_calls[0]).toEqual({ id: 'call_0', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } });
    expect(sent[1]).toEqual({ role: 'tool', tool_call_id: 'call_0', name: 'read_file', content: 'file text' });
  });

  it('echoes a provider signature on tool calls back unchanged (Gemini 3 thought signatures)', async () => {
    const signature = { google: { thought_signature: 'EvwBCvkBAWkUfRMs...opaque' } };
    const fetchMock = vi.fn(async () =>
      reply({ content: null, tool_calls: [{ id: 'c1', extra_content: signature, function: { name: 'add', arguments: '{"a":1}' } }, { id: 'c2', function: { name: 'add', arguments: '{"a":2}' } }] }),
    );
    const { client: c } = client(fetchMock as unknown as typeof fetch);

    const res = await c.chat({ messages: [{ role: 'user', content: 'go' }] });
    expect(res.toolCalls[0].extraContent).toEqual(signature);
    expect(res.toolCalls[1]).not.toHaveProperty('extraContent'); // only what the provider sent is echoed

    await c.chat({ messages: [{ role: 'assistant', content: null, toolCalls: res.toolCalls }, { role: 'tool', toolCallId: 'c1', name: 'add', content: '3' }] });
    const sent = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).messages[0].tool_calls;
    expect(sent[0].extra_content).toEqual(signature);
    expect(sent[1]).not.toHaveProperty('extra_content');
  });

  it('retries 429 and 5xx with backoff, honoring Retry-After, then succeeds', async () => {
    const responses = [new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'retry-after': '7' } }), new Response('oops', { status: 503 }), reply({ content: 'finally' })];
    const { client: c, sleeps } = client((async () => responses.shift()!) as unknown as typeof fetch);
    expect((await c.chat({ messages: [] })).content).toBe('finally');
    expect(sleeps).toEqual([7000, 4000]); // Retry-After wins; otherwise 2s * 2^attempt
  });

  it("waits as long as the provider's own retry hint says, instead of guessing", async () => {
    const quota = 'Too many requests. Please retry in 12.3s.';
    const responses = [new Response(JSON.stringify([{ error: { message: quota } }]), { status: 429 }), reply({ content: 'ok' })];
    const { client: c, sleeps } = client((async () => responses.shift()!) as unknown as typeof fetch);
    expect((await c.chat({ messages: [] })).content).toBe('ok');
    expect(sleeps).toEqual([12_800]); // the hinted 12.3s, plus 0.5s slack
  });

  it('fails immediately, without retrying, when the provider says the wait is longer than a minute', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"Please retry in 3600s."}}', { status: 429 }));
    const { client: c, sleeps } = client(fetchMock as unknown as typeof fetch);
    await expect(c.chat({ messages: [] })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('treats a quota error that survives one wait-and-retry as spent, and stops instead of stalling for minutes', async () => {
    const fetchMock = vi.fn(async () => new Response('[{"error":{"message":"You exceeded your current quota. Please retry in 30s."}}]', { status: 429 }));
    const { client: c, sleeps } = client(fetchMock as unknown as typeof fetch);

    await expect(c.chat({ messages: [] })).rejects.toMatchObject({ status: 429, message: expect.stringContaining('quota') });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one try, one retry after the hinted wait, then it gives up
    expect(sleeps).toEqual([30_500]);
  });

  it('still retries a plain rate-limit 429 that is not a quota message, up to maxRetries, and never leaks the key', async () => {
    const fetchMock = vi.fn(async () => new Response('[{"error":{"message":"Too many requests, slow down"}}]', { status: 429 }));
    const { client: c, sleeps } = client(fetchMock as unknown as typeof fetch, { maxRetries: 2 });

    const err = await c.chat({ messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelHttpError);
    expect((err as ModelHttpError).status).toBe(429);
    expect((err as Error).message).toContain('Too many requests');
    expect((err as Error).message).not.toContain('sekret-key'); // the key only ever travels in the Authorization header
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry a client error such as a bad key or bad request', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    const { client: c, sleeps } = client(fetchMock as unknown as typeof fetch);

    await expect(c.chat({ messages: [] })).rejects.toThrow(/400.*API key not valid/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('retries network errors, and rejects malformed responses clearly', async () => {
    let n = 0;
    const flaky = (async () => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return reply({ content: 'ok' });
    }) as unknown as typeof fetch;
    expect((await client(flaky).client.chat({ messages: [] })).content).toBe('ok');

    const empty = client((async () => ok({ choices: [] })) as unknown as typeof fetch, { maxRetries: 0 }).client;
    await expect(empty.chat({ messages: [] })).rejects.toThrow(/no choices/);
    const html = client((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch, { maxRetries: 0 }).client;
    await expect(html.chat({ messages: [] })).rejects.toThrow(/non-JSON/);
  });

  it('reads retry hints in both message and detail form', () => {
    expect(retryHintMs('Please retry in 47.999556766s.')).toBe(48_000);
    expect(retryHintMs('{"retryDelay": "33s"}')).toBe(33_000);
    expect(retryHintMs('something else')).toBeNull();
  });
});

describe('the rate limiter', () => {
  /** A fake clock where sleeping just advances time, so tests are instant and exact. */
  function fakeClock() {
    let t = 1_000_000;
    const sleeps: number[] = [];
    return { sleeps, now: () => t, sleep: async (ms: number) => void (sleeps.push(ms), (t += ms)), advance: (ms: number) => void (t += ms) };
  }

  it('lets a burst through up to the limit, then makes the next caller wait for the window to slide', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(3, clock);
    await limiter.acquire();
    clock.advance(10_000);
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]); // three in a row: no waiting

    await limiter.acquire(); // the 4th waits until 60s after the first (50s from now), plus slack
    expect(clock.sleeps).toEqual([50_050]);
  });

  it('never allows more than the limit in any 60 seconds, however many callers queue at once', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(2, clock);
    const sentAt: number[] = [];
    await Promise.all(Array.from({ length: 7 }, async () => (await limiter.acquire(), sentAt.push(clock.now()))));

    expect(sentAt).toHaveLength(7);
    for (const t of sentAt) expect(sentAt.filter((u) => u >= t && u < t + 60_000).length).toBeLessThanOrEqual(2);
  });

  it('rejects a nonsense limit', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => createRateLimiter(bad), String(bad)).toThrow(/positive integer/);
  });

  it('is consulted before every attempt, retries included, because a 429 still uses a request', async () => {
    let acquired = 0;
    const responses = [new Response('busy', { status: 503 }), new Response('busy', { status: 503 }), reply({ content: 'ok' })];
    const { client: c } = client((async () => responses.shift()!) as unknown as typeof fetch, { limiter: { acquire: async () => void acquired++ } });
    expect((await c.chat({ messages: [] })).content).toBe('ok');
    expect(acquired).toBe(3);
  });

  it('paces Gemini by default, honors an override, and can be turned off', () => {
    expect(configuredRpm('gemini:m', {})).toBe(15);
    expect(configuredRpm('gemini:m', { GEO_GEMINI_RPM: '5' })).toBe(5);
    expect(configuredRpm('gemini:m', { GEO_GEMINI_RPM: 'off' })).toBeNull();
    expect(configuredRpm('openrouter:m', {})).toBeNull();
    expect(() => configuredRpm('gemini:m', { GEO_GEMINI_RPM: 'fast' })).toThrow(/positive integer/);
  });
});

describe('model specs', () => {
  it('splits provider from model at the first colon only', () => {
    expect(parseModelSpec('gemini:gemini-3.1-flash-lite')).toEqual({ provider: 'gemini', model: 'gemini-3.1-flash-lite' });
    expect(parseModelSpec('openrouter:google/gemma-4-31b-it:free')).toEqual({ provider: 'openrouter', model: 'google/gemma-4-31b-it:free' });
    for (const bad of ['gemini', 'gemini:', ':m', 'nope:m', '']) expect(() => parseModelSpec(bad), bad).toThrow(/invalid model/);
  });

  it('requires the provider key from the environment, and names it', () => {
    expect(() => createModelClient('gemini:m', {})).toThrow('GEMINI_API_KEY is required');
    expect(() => createModelClient('openrouter:m', { GEMINI_API_KEY: 'k' })).toThrow('OPENROUTER_API_KEY is required');
    expect(createModelClient('gemini:m', { GEMINI_API_KEY: 'k' }).id).toBe('gemini:m');
  });

  it('picks the agent model from GEO_AGENT_MODEL (first entry), else the default', () => {
    expect(agentModelSpec({})).toBe(DEFAULT_AGENT_MODEL);
    expect(agentModelSpec({ GEO_AGENT_MODEL: '  ' })).toBe(DEFAULT_AGENT_MODEL);
    expect(agentModelSpec({ GEO_AGENT_MODEL: 'gemini:a, gemini:b' })).toBe('gemini:a');
  });
});
