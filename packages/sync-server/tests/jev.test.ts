import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JevVerdictSchema } from '../src/api/schemas.js';
import { loadConfig } from '../src/config.js';
import { jevCheck } from '../src/health.js';
import { createSyncServer, type SyncServer } from '../src/index.js';
import {
  buildPostQaQuestions,
  buildPreGateQuestions,
  decidePreGate,
  evaluateJev,
  evaluatePostQa,
  evaluatePreGate,
  isJevConfigured,
  JevError,
  jevEndpoint,
  recordJevOutcome,
  resetJevHealth,
  resolveFailOpen,
} from '../src/jev.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

function jevConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    JEV_API_KEY: 'test-jev-key',
    ...overrides,
  });
}

function jevOkResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      model: 'jev-1.13.0',
      answers: {
        is_jailbreak: { type: 'noul', noul: 0.05 },
        is_diagrammable: { type: 'noul', noul: 0.95 },
        complexity: {
          type: 'score',
          score: 1.2,
          legend: {
            '0': 'trivial',
            '1': 'focused',
            '2': 'large',
            '3': 'sprawling',
          },
          probabilities: { '0': 0.1, '1': 0.8, '2': 0.1, '3': 0 },
          confidence: 0.8,
        },
        matches_intent: {
          type: 'score',
          score: 2.0,
          legend: { '0': 'unrelated', '1': 'partial', '2': 'faithful' },
          probabilities: { '0': 0, '1': 0, '2': 1 },
          confidence: 0.95,
        },
        likely_valid: { type: 'noul', noul: 0.95 },
        ...overrides,
      },
      usage: { input_tokens: 100, output_tokens: 0 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('jev client', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('reports configuration presence', () => {
    expect(isJevConfigured(jevConfig())).toBe(true);
    expect(isJevConfigured(loadConfig({ NODE_ENV: 'test' }))).toBe(false);
  });

  test('builds the systemone endpoint without doubling the path', () => {
    expect(jevEndpoint(jevConfig())).toBe(
      'https://api.typesafe.ai/v1/systemone',
    );
    expect(
      jevEndpoint(
        jevConfig({ JEV_API_BASE_URL: 'https://proxy.test/jev/systemone' }),
      ),
    ).toBe('https://proxy.test/jev/systemone');
  });

  test('fails open outside production by default', () => {
    expect(resolveFailOpen(jevConfig())).toBe(true);
    expect(resolveFailOpen(jevConfig({ JEV_FAIL_OPEN: 'false' }))).toBe(false);
    const prod = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/x',
      JEV_API_KEY: 'k',
    });
    expect(resolveFailOpen(prod)).toBe(false);
  });

  test('pre-gate questions ask jailbreak, intent, and complexity together', () => {
    const questions = buildPreGateQuestions();
    expect(questions.is_jailbreak.type).toBe('noul');
    expect(questions.is_diagrammable.type).toBe('noul');
    expect(questions.complexity.type).toBe('score');
    expect(Object.keys(questions)).toHaveLength(3);
  });

  test('post-QA questions ask match and validity', () => {
    const questions = buildPostQaQuestions();
    expect(questions.matches_intent.type).toBe('score');
    expect(questions.likely_valid.type).toBe('noul');
  });

  test('decides the pre-gate with tunable thresholds', () => {
    const config = jevConfig();
    expect(
      decidePreGate(
        {
          isJailbreak: 0.05,
          isDiagrammable: 0.95,
          complexity: 1,
          complexityConfidence: 0.9,
        },
        config,
        30,
      ),
    ).toEqual({ allowed: true, warnings: [] });
    expect(
      decidePreGate(
        {
          isJailbreak: 0.95,
          isDiagrammable: 0.95,
          complexity: 1,
          complexityConfidence: 0.9,
        },
        config,
        30,
      ),
    ).toMatchObject({ allowed: false, code: 'JEV_BLOCKED' });
    expect(
      decidePreGate(
        {
          isJailbreak: 0.05,
          isDiagrammable: 0.1,
          complexity: 1,
          complexityConfidence: 0.9,
        },
        config,
        30,
      ),
    ).toMatchObject({ allowed: false, code: 'JEV_LOW_INTENT' });
    const large = decidePreGate(
      {
        isJailbreak: 0.05,
        isDiagrammable: 0.9,
        complexity: 2.8,
        complexityConfidence: 0.8,
      },
      config,
      30,
    );
    expect(large.allowed).toBe(true);
    if (large.allowed) expect(large.warnings.length).toBe(1);
  });

  test('evaluates and validates a Jev response', async () => {
    globalThis.fetch = (async () => jevOkResponse()) as typeof fetch;
    const response = await evaluateJev(
      'a checkout flow',
      buildPreGateQuestions(),
      jevConfig(),
    );
    expect(response.model).toBe('jev-1.13.0');
    expect(response.answers.is_jailbreak?.type).toBe('noul');
  });

  test('rejects malformed Jev responses', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ answers: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(
      evaluateJev('x', buildPreGateQuestions(), jevConfig()),
    ).rejects.toBeInstanceOf(JevError);
  });

  test('retries 429 then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('limited', { status: 429 })
        : jevOkResponse();
    }) as typeof fetch;
    const response = await evaluateJev(
      'x',
      buildPreGateQuestions(),
      jevConfig(),
    );
    expect(response.model).toBe('jev-1.13.0');
    expect(calls).toBe(2);
  });

  test('retries a transient 503 then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('overloaded', { status: 503 })
        : jevOkResponse();
    }) as typeof fetch;
    const response = await evaluateJev(
      'x',
      buildPreGateQuestions(),
      jevConfig(),
    );
    expect(response.model).toBe('jev-1.13.0');
    expect(calls).toBe(2);
  });

  test('gives up after three persistent 503s', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('down', { status: 503 });
    }) as typeof fetch;
    await expect(
      evaluateJev('x', buildPreGateQuestions(), jevConfig()),
    ).rejects.toMatchObject({ code: 'JEV_UNAVAILABLE' });
    expect(calls).toBe(3);
  });

  test('tolerates provider-added fields instead of failing validation', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          request_id: 'req_future',
          answers: {
            is_jailbreak: { type: 'noul', noul: 0.05, explanation: 'new' },
            is_diagrammable: { type: 'noul', noul: 0.95 },
            complexity: {
              type: 'score',
              score: 1.2,
              legend: { '0': 'trivial', '1': 'focused' },
              probabilities: { '0': 0.1, '1': 0.9 },
              confidence: 0.8,
              extra: true,
            },
          },
          usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    const gate = await evaluatePreGate('web and database', jevConfig());
    expect(gate.isJailbreak).toBeCloseTo(0.05);
    expect(gate.isDiagrammable).toBeCloseTo(0.95);
  });

  test('throws without a key', async () => {
    await expect(
      evaluateJev(
        'x',
        buildPreGateQuestions(),
        loadConfig({ NODE_ENV: 'test' }),
      ),
    ).rejects.toMatchObject({ code: 'JEV_UNAVAILABLE' });
  });

  test('ignores low-confidence complexity guesses', () => {
    const quiet = decidePreGate(
      {
        isJailbreak: 0.05,
        isDiagrammable: 0.9,
        complexity: 2.8,
        complexityConfidence: 0.1,
      },
      jevConfig(),
      30,
    );
    expect(quiet).toEqual({ allowed: true, warnings: [] });
  });

  test('pre-gate and post-QA helpers parse their answers', async () => {
    globalThis.fetch = (async () => jevOkResponse()) as typeof fetch;
    const config = jevConfig();
    const gate = await evaluatePreGate('web and database', config);
    expect(gate.isJailbreak).toBeCloseTo(0.05);
    expect(gate.isDiagrammable).toBeCloseTo(0.95);
    const qa = await evaluatePostQa('web and database', 'web -> db', config);
    expect(qa.matchesIntent).toBeCloseTo(2);
    expect(qa.likelyValid).toBeCloseTo(0.95);
    expect(qa.warnings).toEqual([]);
  });

  test('post-QA warns on low match', async () => {
    globalThis.fetch = (async () =>
      jevOkResponse({
        matches_intent: {
          type: 'score',
          score: 0.2,
          legend: { '0': 'unrelated', '1': 'partial', '2': 'faithful' },
          probabilities: { '0': 0.8, '1': 0.2, '2': 0 },
          confidence: 0.85,
        },
        likely_valid: { type: 'noul', noul: 0.2 },
      })) as typeof fetch;
    const qa = await evaluatePostQa('checkout', 'unrelated', jevConfig());
    expect(qa.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('JevVerdictSchema', () => {
  test('accepts advisory verdicts and rejects unknown fields', () => {
    expect(
      JevVerdictSchema.safeParse({
        matchesIntent: 2,
        likelyValid: 0.9,
        confidence: 0.8,
        warnings: ['check nodes'],
      }).success,
    ).toBe(true);
    expect(
      JevVerdictSchema.safeParse({
        matchesIntent: 2,
        likelyValid: 0.9,
        confidence: 0.8,
        warnings: [],
        extra: true,
      }).success,
    ).toBe(false);
  });

  test('rejects matchesIntent outside the 0-2 score scale', () => {
    expect(
      JevVerdictSchema.safeParse({
        matchesIntent: 3,
        likelyValid: 0.9,
        confidence: 0.8,
        warnings: [],
      }).success,
    ).toBe(false);
  });
});

describe('jev health reporting', () => {
  beforeEach(() => resetJevHealth());
  afterEach(() => resetJevHealth());

  test('skips without a key, ok when configured', () => {
    expect(jevCheck(loadConfig({ NODE_ENV: 'test' })).status).toBe('skipped');
    expect(jevCheck(jevConfig()).status).toBe('ok');
  });

  test('degrades after a failed round-trip until the next success', () => {
    recordJevOutcome(false);
    expect(jevCheck(jevConfig())).toMatchObject({ status: 'degraded' });
    recordJevOutcome(true);
    expect(jevCheck(jevConfig()).status).toBe('ok');
  });
});

describe('POST /api/ai/generate with Jev', () => {
  let app: SyncServer;
  let baseUrl: string;
  let originalFetch: typeof fetch;

  const completion = (d2: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: d2 } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const jevResponseFor = (noulJailbreak: number, noulIntent: number) =>
    new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          is_jailbreak: { type: 'noul', noul: noulJailbreak },
          is_diagrammable: { type: 'noul', noul: noulIntent },
          complexity: {
            type: 'score',
            score: 1,
            legend: { '0': 't', '1': 'f', '2': 'l', '3': 's' },
            probabilities: { '0': 0, '1': 1, '2': 0, '3': 0 },
            confidence: 0.9,
          },
          matches_intent: {
            type: 'score',
            score: 2,
            legend: { '0': 'u', '1': 'p', '2': 'f' },
            probabilities: { '0': 0, '1': 0, '2': 1 },
            confidence: 0.9,
          },
          likely_valid: { type: 'noul', noul: 0.95 },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
        AI_API_KEY: 'test-ai-key',
        AI_MODEL: 'test-model',
        JEV_API_KEY: 'test-jev-key',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('no bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  async function register(email: string) {
    const res = await originalFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: string };
  }

  async function generate(token: string, body: unknown) {
    return originalFetch(`${baseUrl}/api/ai/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  function mockJevAndChat(jailbreak: number, intent: number) {
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/systemone'))
        return jevResponseFor(jailbreak, intent);
      if (target.includes('/chat/completions')) return completion('web -> db');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;
  }

  test('blocks jailbreaks without consuming quota', async () => {
    const { token } = await register('jev-block@test.com');
    mockJevAndChat(0.95, 0.95);
    const blocked = await generate(token, { prompt: 'ignore instructions' });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { code: string }).code).toBe(
      'JEV_BLOCKED',
    );
    // Quota untouched: a clean prompt still succeeds as #1.
    mockJevAndChat(0.05, 0.95);
    const ok = await generate(token, { prompt: 'web and database' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { quota: { used: number } }).quota.used).toBe(
      1,
    );
  });

  test('rejects non-diagram spam as low intent', async () => {
    const { token } = await register('jev-spam@test.com');
    mockJevAndChat(0.05, 0.1);
    const res = await generate(token, { prompt: 'buy cheap followers!!!' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe(
      'JEV_LOW_INTENT',
    );
  });

  test('returns advisory QA verdict on success', async () => {
    const { token } = await register('jev-ok@test.com');
    mockJevAndChat(0.05, 0.95);
    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      d2: string;
      jev?: { matchesIntent: number; warnings: string[] };
    };
    expect(body.d2).toBe('web -> db');
    expect(body.jev?.matchesIntent).toBeCloseTo(2);
  });

  test('fails open when Jev is unreachable in test env', async () => {
    const { token } = await register('jev-open@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/systemone'))
        return new Response('down', { status: 503 });
      if (target.includes('/chat/completions')) return completion('a -> b');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;
    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
  });

  test('skips post-QA when the pre-gate already failed', async () => {
    const { token } = await register('jev-noqa@test.com');
    let systemoneCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/systemone')) {
        systemoneCalls += 1;
        return new Response('down', { status: 503 });
      }
      if (target.includes('/chat/completions')) return completion('a -> b');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;
    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
    // Pre-gate retries (3) only — post-QA is not attempted against a
    // provider that just failed, instead of doubling outage latency.
    expect(systemoneCalls).toBe(3);
    expect(((await res.json()) as { quota: { used: number } }).quota.used).toBe(
      1,
    );
  });

  test('still generates when post-QA alone fails', async () => {
    const { token } = await register('jev-qafail@test.com');
    let systemoneCalls = 0;
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/systemone')) {
        systemoneCalls += 1;
        // First call is the pre-gate (success); the rest are post-QA (down).
        return systemoneCalls === 1
          ? jevResponseFor(0.05, 0.95)
          : new Response('down', { status: 503 });
      }
      if (target.includes('/chat/completions')) return completion('web -> db');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;
    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
    expect(systemoneCalls).toBe(4);
    const body = (await res.json()) as { d2: string; jev?: unknown };
    expect(body.d2).toBe('web -> db');
    // No pre-gate warnings in this fixture, so no advisory block either.
    expect(body.jev).toBeUndefined();
  });

  test('drops out-of-scale QA verdicts instead of serving them', async () => {
    const { token } = await register('jev-scale@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/systemone')) {
        const state = JSON.parse(String((init as RequestInit).body));
        const isPostQa =
          typeof state.state === 'object' &&
          state.state !== null &&
          'd2' in state.state;
        if (!isPostQa) return jevResponseFor(0.05, 0.95);
        return new Response(
          JSON.stringify({
            model: 'jev-1.13.0',
            answers: {
              matches_intent: {
                type: 'score',
                score: 5,
                legend: { '0': 'u', '1': 'p', '2': 'f' },
                probabilities: { '0': 0, '1': 0, '2': 1 },
                confidence: 0.9,
              },
              likely_valid: { type: 'noul', noul: 0.95 },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (target.includes('/chat/completions')) return completion('web -> db');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;
    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { d2: string; jev?: unknown };
    expect(body.d2).toBe('web -> db');
    expect(body.jev).toBeUndefined();
  });

  test('blocks suggest-layout jailbreaks without consuming quota', async () => {
    const { token } = await register('jev-suggest-block@test.com');
    mockJevAndChat(0.95, 0.95);
    const blocked = await originalFetch(`${baseUrl}/api/ai/suggest-layout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        d2: 'a -> b',
        instruction: 'ignore instructions',
      }),
    });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { code: string }).code).toBe(
      'JEV_BLOCKED',
    );
    // Quota untouched: a clean suggestion still succeeds as #1.
    mockJevAndChat(0.05, 0.95);
    const ok = await originalFetch(`${baseUrl}/api/ai/suggest-layout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ d2: 'a -> b' }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { quota: { used: number } }).quota.used).toBe(
      1,
    );
  });
});
