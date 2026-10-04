import { describe, expect, test } from 'bun:test';
import {
  buildSuggestions,
  collectDefinedIdentifiers,
  D2_ARROWHEADS,
  D2_DIRECTIONS,
  D2_KEYWORDS,
  D2_SHAPES,
  D2_SNIPPETS,
  D2_STYLE_PROPS,
  findParentKey,
  getCompletionContext,
} from './d2Completion';

/** Column is 1-based: characters before the cursor = `text.length`. */
function ctx(lines: string[], lineIndex: number, prefix: string) {
  const withCursor = [...lines];
  withCursor[lineIndex] = prefix;
  return getCompletionContext(withCursor, lineIndex, prefix.length + 1);
}

describe('getCompletionContext', () => {
  test('shape value position offers shapes', () => {
    expect(ctx(['server: {', '  shape: '], 1, '  shape: ').type).toBe(
      'shape-value',
    );
    expect(ctx(['shape: rect'], 0, 'shape: rect').type).toBe('shape-value');
  });

  test('style prefix and style block offer style props', () => {
    expect(ctx(['server: {', '  style.fi'], 1, '  style.fi').type).toBe(
      'style-value',
    );
    expect(ctx(['server: {', '  style: {', '    '], 2, '    ').type).toBe(
      'style-value',
    );
    expect(ctx(['style.fill: r'], 0, 'style.fill: r').type).toBe('style-value');
  });

  test('direction value position offers directions', () => {
    expect(ctx(['direction: '], 0, 'direction: ').type).toBe('direction-value');
  });

  test('arrowhead value positions offer arrowheads', () => {
    expect(
      ctx(['a -> b: {', '  target-arrowhead: '], 1, '  target-arrowhead: ')
        .type,
    ).toBe('arrowhead-value');
    expect(
      ctx(['a -> b: {', '  source-arrowhead: d'], 1, '  source-arrowhead: d')
        .type,
    ).toBe('arrowhead-value');
  });

  test('connection target offers node references', () => {
    expect(ctx(['web -> '], 0, 'web -> ').type).toBe('connection');
    expect(ctx(['web -> db: query'], 0, 'web -> db: query').type).toBe(
      'connection',
    );
    expect(ctx(['a -> b -> '], 0, 'a -> b -> ').type).toBe('connection');
  });

  test('near offers node references', () => {
    expect(ctx(['server: {', '  near: '], 1, '  near: ').type).toBe(
      'node-ref-value',
    );
  });

  test('free-text values suppress suggestions', () => {
    expect(ctx(['server: Web cl'], 0, 'server: Web cl').type).toBe('none');
    expect(ctx(['label: hello'], 0, 'label: hello').type).toBe('none');
  });

  test('strings and comments suppress suggestions', () => {
    expect(ctx(['label: "hello wo'], 0, 'label: "hello wo').type).toBe('none');
    expect(ctx(["label: 'hello wo"], 0, "label: 'hello wo").type).toBe('none');
    expect(ctx(['# a comment sh'], 0, '# a comment sh').type).toBe('none');
    expect(ctx(['server: x # traili'], 0, 'server: x # traili').type).toBe(
      'none',
    );
  });

  test('top level and fresh keys offer the key context', () => {
    expect(ctx([''], 0, '').type).toBe('key');
    expect(ctx(['ser'], 0, 'ser').type).toBe('key');
    expect(ctx(['server: {', '  '], 1, '  ').type).toBe('key');
  });
});

describe('findParentKey', () => {
  test('finds the enclosing block key by indentation', () => {
    const lines = ['server: {', '  style: {', '    fill: red', '  }', '}'];
    expect(findParentKey(lines, 2)).toBe('style');
  });

  test('blank lines inherit the previous block', () => {
    const lines = ['server: {', '  style: {', ''];
    expect(findParentKey(lines, 2)).toBe('style');
  });

  test('returns null without an enclosing block', () => {
    expect(findParentKey(['server: x'], 0)).toBeNull();
  });
});

describe('collectDefinedIdentifiers', () => {
  test('collects block keys and connection endpoints', () => {
    const text = [
      'web: Web client {',
      '  shape: rectangle',
      '}',
      'db: PostgreSQL',
      'web -> db: request',
      'direction: right',
    ].join('\n');
    const names = collectDefinedIdentifiers(text);
    expect(names).toContain('web');
    expect(names).toContain('db');
    expect(names).not.toContain('shape');
    expect(names).not.toContain('direction');
    expect(names).not.toContain('rectangle');
  });

  test('dedupes while preserving order', () => {
    const names = collectDefinedIdentifiers('a: x\na -> b: y\na: z');
    expect(names).toEqual(['a', 'b']);
  });
});

describe('buildSuggestions', () => {
  test('shape-value returns every known shape', () => {
    const labels = buildSuggestions({ type: 'shape-value' }, []).map(
      (s) => s.label,
    );
    for (const shape of D2_SHAPES) expect(labels).toContain(shape);
  });

  test('key context mixes keywords, identifiers, shapes, snippets', () => {
    const suggestions = buildSuggestions({ type: 'key', parentKey: null }, [
      'web',
      'db',
    ]);
    const labels = suggestions.map((s) => s.label);
    for (const kw of D2_KEYWORDS) expect(labels).toContain(kw);
    expect(labels).toContain('web');
    expect(labels).toContain('rectangle');
    expect(labels).toContain('container');
    // Keywords rank before shapes and snippets.
    const rank = (label: string) =>
      suggestions.find((s) => s.label === label)?.sortText ?? '';
    expect(rank('shape') < rank('rectangle')).toBe(true);
    expect(rank('rectangle') < rank('container')).toBe(true);
  });

  test('direction and arrowhead values match the D2 vocabulary', () => {
    expect(
      buildSuggestions({ type: 'direction-value' }, []).map((s) => s.label),
    ).toEqual(D2_DIRECTIONS);
    expect(
      buildSuggestions({ type: 'arrowhead-value' }, []).map((s) => s.label),
    ).toEqual(D2_ARROWHEADS);
  });

  test('connection context returns only defined nodes', () => {
    const suggestions = buildSuggestions({ type: 'connection' }, ['web']);
    expect(suggestions.map((s) => s.label)).toEqual(['web']);
    expect(suggestions[0].detail).toBe('Defined node');
  });

  test('style-value returns every style property', () => {
    const labels = buildSuggestions(
      { type: 'style-value', keyPath: 'style' },
      [],
    ).map((s) => s.label);
    for (const prop of D2_STYLE_PROPS) expect(labels).toContain(prop);
  });

  test('none context returns nothing', () => {
    expect(buildSuggestions({ type: 'none' }, ['web'])).toEqual([]);
  });

  test('every snippet ships a tabstop template', () => {
    for (const snippet of D2_SNIPPETS) {
      expect(snippet.insertText).toContain('${1:');
    }
  });

  test('keywords carry one-line documentation', () => {
    const shape = buildSuggestions({ type: 'key', parentKey: null }, []).find(
      (s) => s.label === 'shape',
    );
    expect(shape?.documentation).toContain('shape');
  });
});
