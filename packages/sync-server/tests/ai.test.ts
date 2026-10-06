import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  AI_QUOTA,
  currentMonth,
  DEFAULT_AI_MODEL,
  extractD2,
  listAiModels,
  MemoryAiUsageStore,
} from '../src/ai.js';
import { loadConfig } from '../src/config.js';
import { createSyncServer, type SyncServer } from '../src/index.js';
import { MemorySnapshotStore } from '../src/RoomLoader.js';

describe('extractD2', () => {
  test('pulls the fenced block out of chat output', () => {
    expect(extractD2('Here you go:\n```d2\na -> b\n```\nEnjoy!')).toBe(
      'a -> b',
    );
  });

  test('accepts unfenced code directly', () => {
    expect(extractD2('  a -> b\n')).toBe('a -> b');
  });

  test('rejects empty responses', () => {
    expect(() => extractD2('   ')).toThrow();
    expect(() => extractD2('```d2\n   \n```')).toThrow();
  });
});

describe('AI quota accounting', () => {
  test('tiers have ascending budgets', () => {
    expect(AI_QUOTA.COMMUNITY).toBeLessThan(AI_QUOTA.PRO);
    expect(AI_QUOTA.PRO).toBeLessThan(AI_QUOTA.ENTERPRISE);
  });

  test('memory store counts per user per month', async () => {
    const store = new MemoryAiUsageStore();
    expect(await store.getUsage('u1', '2026-09')).toBe(0);
    expect(await store.incrementUsage('u1', '2026-09')).toBe(1);
    expect(await store.incrementUsage('u1', '2026-09')).toBe(2);
    expect(await store.getUsage('u2', '2026-09')).toBe(0);
  });

  test('currentMonth is UTC YYYY-MM', () => {
    expect(currentMonth(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01');
  });
});

describe('listAiModels', () => {
  test('advertises the single fixed server model', () => {
    const listed = listAiModels(loadConfig({ NODE_ENV: 'test' }));
    expect(listed.default).toBe(DEFAULT_AI_MODEL);
    expect(listed.models).toEqual([DEFAULT_AI_MODEL]);
  });

  test('defaults to openai/gpt-oss-120b', () => {
    expect(DEFAULT_AI_MODEL).toBe('openai/gpt-oss-120b');
  });

  test('AI_MODEL overrides the fixed default for operators', () => {
    const listed = listAiModels(
      loadConfig({
        NODE_ENV: 'test',
        AI_MODELS: 'team-model-a, team-model-b',
        AI_MODEL: 'house-model',
      }),
    );
    expect(listed.models).toEqual(['house-model']);
    expect(listed.default).toBe('house-model');
  });
});

describe('GET /api/ai/models', () => {
  test('advertises the fixed server model without auth', async () => {
    const app = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
        AI_API_KEY: 'test-ai-key',
        AI_MODELS: 'picker-a, picker-b',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string')
        throw new Error('Server did not bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/ai/models`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        models: string[];
        default: string;
        configured: boolean;
      };
      // No picker: the allowlist is ignored, one fixed model is served.
      expect(body.models).toEqual(['openai/gpt-oss-120b']);
      expect(body.default).toBe('openai/gpt-oss-120b');
      expect(body.configured).toBe(true);
    } finally {
      await app.close();
    }
  });

  test('reports unconfigured servers so the picker can hint setup', async () => {
    const app = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = app.server.address();
      if (!address || typeof address === 'string')
        throw new Error('Server did not bind');
      const res = await fetch(`http://127.0.0.1:${address.port}/api/ai/models`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { configured: boolean }).configured).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/ai/generate', () => {
  let app: SyncServer;
  let baseUrl: string;
  let originalFetch: typeof fetch;

  const completion = (d2: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: d2 } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
        AI_API_KEY: 'test-ai-key',
        AI_MODEL: 'test-model',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Server did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  async function register(email: string) {
    // Bypass the suite's fetch mock by using the real fetch captured above.
    const res = await originalFetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { token: string };
  }

  async function generate(token: string | undefined, body: unknown) {
    return originalFetch(`${baseUrl}/api/ai/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test('requires authentication', async () => {
    const res = await generate(undefined, { prompt: 'a diagram' });
    expect(res.status).toBe(401);
  });

  test('validates the prompt', async () => {
    const { token } = await register('ai-valid@test.com');
    const empty = await generate(token, { prompt: '   ' });
    expect(empty.status).toBe(400);
  });

  test('returns generated D2 with quota accounting', async () => {
    const { token } = await register('ai-ok@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      const target = String(url);
      if (target.includes('/chat/completions')) {
        const payload = JSON.parse((init as { body: string }).body) as {
          model: string;
        };
        expect(payload.model).toBe('test-model');
        return completion('```d2\nweb -> db\n```');
      }
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    const res = await generate(token, { prompt: 'web and database' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      d2: string;
      model: string;
      quota: { used: number; limit: number };
    };
    expect(body.d2).toBe('web -> db');
    expect(body.model).toBe('test-model');
    expect(body.quota.used).toBe(1);
    expect(body.quota.limit).toBe(AI_QUOTA.COMMUNITY);
  });

  test('enforces the monthly quota with 429', async () => {
    const { token } = await register('ai-quota@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions'))
        return completion('a -> b');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    for (let i = 0; i < AI_QUOTA.COMMUNITY; i += 1) {
      const res = await generate(token, { prompt: `diagram ${i}` });
      expect(res.status).toBe(200);
    }
    const exhausted = await generate(token, { prompt: 'one more' });
    expect(exhausted.status).toBe(429);
    expect(((await exhausted.json()) as { code: string }).code).toBe(
      'QUOTA_EXHAUSTED',
    );
  });

  test('surfaces provider failures as 502', async () => {
    const { token } = await register('ai-fail@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions'))
        return new Response('busy', { status: 503 });
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    const res = await generate(token, { prompt: 'diagram' });
    expect(res.status).toBe(502);
  });

  test('503s without an API key', async () => {
    const keyless = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      keyless.server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const addr = keyless.server.address();
      if (!addr || typeof addr === 'string') throw new Error('no bind');
      const reg = await originalFetch(
        `http://127.0.0.1:${addr.port}/api/auth/register`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'ai-nokey@test.com',
            password: 'password123',
          }),
        },
      );
      const { token } = (await reg.json()) as { token: string };
      const res = await originalFetch(
        `http://127.0.0.1:${addr.port}/api/ai/generate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt: 'diagram' }),
        },
      );
      expect(res.status).toBe(503);
    } finally {
      await keyless.close();
    }
  });

  test('ignores the legacy client model and uses the fixed server model', async () => {
    const { token } = await register('ai-fixedmodel@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions')) {
        const payload = JSON.parse((init as { body: string }).body) as {
          model: string;
        };
        expect(payload.model).toBe('test-model');
        return completion('```d2\nweb -> db\n```');
      }
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    const res = await generate(token, {
      prompt: 'web and database',
      model: 'attacker-chosen-model',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { model: string };
    expect(body.model).toBe('test-model');
  });
});

describe('POST /api/ai/suggest-layout', () => {
  let app: SyncServer;
  let baseUrl: string;
  let originalFetch: typeof fetch;

  const completion = (d2: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: d2 } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = createSyncServer(
      loadConfig({
        NODE_ENV: 'test',
        ROOM_TICKET_SECRET: 'test-secret-32-chars-long-secret!!',
        AI_API_KEY: 'test-ai-key',
        AI_MODEL: 'test-model',
      }),
      new MemorySnapshotStore(),
    );
    await new Promise<void>((resolve) =>
      app.server.listen(0, '127.0.0.1', resolve),
    );
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Server did not bind');
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

  async function suggest(token: string | undefined, body: unknown) {
    return originalFetch(`${baseUrl}/api/ai/suggest-layout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test('requires authentication', async () => {
    const res = await suggest(undefined, { d2: 'a -> b' });
    expect(res.status).toBe(401);
  });

  test('validates the current diagram', async () => {
    const { token } = await register('ai-suggest-valid@test.com');
    const empty = await suggest(token, { d2: '   ' });
    expect(empty.status).toBe(400);
  });

  test('returns a suggested layout with quota accounting', async () => {
    const { token } = await register('ai-suggest-ok@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions')) {
        const payload = JSON.parse((init as { body: string }).body) as {
          model: string;
          messages: Array<{ role: string; content: string }>;
        };
        expect(payload.model).toBe('test-model');
        expect(payload.messages.some((m) => m.content.includes('a -> b'))).toBe(
          true,
        );
        return completion('```d2\ndirection: right\na -> b\n```');
      }
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    const res = await suggest(token, { d2: 'a -> b' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      d2: string;
      model: string;
      quota: { used: number; limit: number };
    };
    expect(body.d2).toBe('direction: right\na -> b');
    expect(body.model).toBe('test-model');
    expect(body.quota.used).toBe(1);
    expect(body.quota.limit).toBe(AI_QUOTA.COMMUNITY);
  });

  test('shares the monthly quota with generation', async () => {
    const { token } = await register('ai-suggest-quota@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions'))
        return completion('a -> b');
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    for (let i = 0; i < AI_QUOTA.COMMUNITY; i += 1) {
      const viaGenerate = i % 2 === 0;
      const res = viaGenerate
        ? await originalFetch(`${baseUrl}/api/ai/generate`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ prompt: `diagram ${i}` }),
          })
        : await suggest(token, { d2: 'a -> b' });
      expect(res.status).toBe(200);
    }
    const exhausted = await suggest(token, { d2: 'a -> b' });
    expect(exhausted.status).toBe(429);
    expect(((await exhausted.json()) as { code: string }).code).toBe(
      'QUOTA_EXHAUSTED',
    );
  });

  test('surfaces provider failures as 502', async () => {
    const { token } = await register('ai-suggest-fail@test.com');
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).includes('/chat/completions'))
        return new Response('busy', { status: 503 });
      return originalFetch(url as string, init as RequestInit);
    }) as typeof fetch;

    const res = await suggest(token, { d2: 'a -> b' });
    expect(res.status).toBe(502);
  });
});
