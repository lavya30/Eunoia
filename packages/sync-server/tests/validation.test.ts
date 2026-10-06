import { describe, expect, test } from 'bun:test';
import {
  CompileRequestSchema,
  CursorTelemetrySchema,
  SnapshotQuerySchema,
  SuggestLayoutSchema,
} from '../src/api/schemas.js';
import { compileD2 } from '../src/d2-compiler.js';

describe('request schemas', () => {
  test('accepts valid compile requests and rejects unknown fields', () => {
    expect(
      CompileRequestSchema.safeParse({
        source: 'a -> b',
        engine: 'dagre',
      }).success,
    ).toBe(true);
    expect(
      CompileRequestSchema.safeParse({ source: 'a -> b', debug: true }).success,
    ).toBe(false);
  });

  test('bounds cursor telemetry before it reaches a room', () => {
    expect(
      CursorTelemetrySchema.safeParse({
        type: 'cursor',
        x: 10,
        y: 20,
        timestamp: Date.now(),
      }).success,
    ).toBe(true);
    expect(
      CursorTelemetrySchema.safeParse({
        type: 'cursor',
        x: Number.POSITIVE_INFINITY,
        y: 20,
      }).success,
    ).toBe(false);
  });

  test('coerces query strings into bounded snapshot options', () => {
    expect(SnapshotQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(() => SnapshotQuerySchema.parse({ limit: '500' })).toThrow();
    expect(() => SnapshotQuerySchema.parse({ before: 'not-a-date' })).toThrow();
  });

  test('bounds layout suggestions and defaults the instruction', () => {
    expect(SuggestLayoutSchema.safeParse({ d2: 'a -> b' }).success).toBe(true);
    expect(SuggestLayoutSchema.parse({ d2: 'a -> b' }).instruction).toBe(
      'Improve the layout of this diagram',
    );
    expect(SuggestLayoutSchema.safeParse({ d2: '   ' }).success).toBe(false);
    expect(
      SuggestLayoutSchema.safeParse({ d2: 'a -> b', debug: true }).success,
    ).toBe(false);
  });

  test('falls back to a local layout on malformed compiler responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ nodes: 'not-an-array', edges: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const result = await compileD2(
        { source: 'a -> b' },
        {
          compilerUrl: 'http://compiler.test/compile',
          isDevelopment: true,
          tier: 'COMMUNITY',
          nodeLimit: 30,
        },
      );
      expect(result.fallback).toBe(true);
      expect(result.nodes.length).toBe(2);
      expect(result.error).toContain('invalid response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('reports compiler unavailability in production instead of falling back', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };
    try {
      await expect(
        compileD2(
          { source: 'a -> b' },
          {
            compilerUrl: 'http://compiler.test/compile',
            isDevelopment: false,
            tier: 'COMMUNITY',
            nodeLimit: 30,
          },
        ),
      ).rejects.toMatchObject({ code: 'D2_COMPILER_UNAVAILABLE' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
