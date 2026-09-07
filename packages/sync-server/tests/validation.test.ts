import { describe, expect, test } from 'bun:test';
import {
  CompileRequestSchema,
  CursorTelemetrySchema,
  SnapshotQuerySchema,
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

  test('rejects malformed responses from the D2 compiler', async () => {
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
      expect(result.placeholder).toBe(true);
      expect(result.error).toContain('invalid response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
