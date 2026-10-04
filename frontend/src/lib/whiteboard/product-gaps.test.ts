import { describe, expect, test } from 'bun:test';
import { parseBoardExport, parseD2Import } from './board-import';
import { extractMentions } from './comments';
import { BOARD_TEMPLATES } from './templates';

describe('board-import', () => {
  test('parses a valid board export', () => {
    const parsed = parseBoardExport(
      JSON.stringify({
        kind: 'eunoia-board',
        version: 1,
        nodes: [{ id: 'n1', x: 0, y: 0 }],
        arrows: [],
        strokes: [],
        code: 'a -> b',
      }),
    );
    expect(parsed?.nodes.length).toBe(1);
    expect(parsed?.code).toBe('a -> b');
  });

  test('rejects non-board JSON', () => {
    expect(parseBoardExport('{}')).toBeNull();
    expect(parseBoardExport('not json')).toBeNull();
    expect(parseBoardExport(JSON.stringify({ kind: 'other' }))).toBeNull();
  });

  test('parses D2 imports', () => {
    expect(parseD2Import('  a -> b  ')).toBe('a -> b');
    expect(parseD2Import('   ')).toBeNull();
  });
});

describe('comments', () => {
  test('extracts @mentions', () => {
    expect(extractMentions('hey @ada and @bex-2, look')).toEqual([
      'ada',
      'bex-2',
    ]);
    expect(extractMentions('no mentions')).toEqual([]);
  });
});

describe('templates', () => {
  test('every template has a name and non-empty D2', () => {
    expect(BOARD_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of BOARD_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.d2.trim().length).toBeGreaterThan(0);
    }
  });
});
