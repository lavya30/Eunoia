/**
 * Pure (Monaco-free) D2 completion model: shared word lists, cursor-context
 * detection, and suggestion building. Kept free of Monaco imports so it can
 * be unit-tested with `bun test`; `d2Language.ts` holds only the thin
 * `registerCompletionItemProvider` adapter.
 *
 * The Monarch tokenizer in `d2Language.ts` derives its keyword/shape lists
 * from the constants here so highlighting and completion can never drift
 * apart again.
 */

import { STENCILS } from '@/lib/whiteboard/stencils';

export const D2_SHAPES = [
  'rectangle',
  'square',
  'page',
  'parallelogram',
  'document',
  'cylinder',
  'queue',
  'package',
  'step',
  'callout',
  'stored_data',
  'person',
  'diamond',
  'oval',
  'circle',
  'hexagon',
  'cloud',
  'text',
  'code',
  'sql_table',
  'class',
  'sequence_diagram',
  'image',
];

export const D2_KEYWORDS = [
  'shape',
  'style',
  'label',
  'direction',
  'link',
  'tooltip',
  'icon',
  'constraint',
  'near',
  'width',
  'height',
  'top',
  'bottom',
  'left',
  'right',
  'grid-rows',
  'grid-columns',
  'grid-gap',
  'source-arrowhead',
  'target-arrowhead',
  'opacity',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dash',
  'font-size',
  'font-color',
  'bold',
  'italic',
  'underline',
  'shadow',
  'multiple',
  'animated',
  'border-radius',
  '3d',
  'double-border',
];

export const D2_STYLE_PROPS = [
  'fill',
  'fill-pattern',
  'stroke',
  'stroke-width',
  'stroke-dash',
  'opacity',
  'font-size',
  'font',
  'font-color',
  'bold',
  'italic',
  'underline',
  'shadow',
  'border-radius',
  'animated',
  '3d',
  'double-border',
  'multiple',
  'stroke-gradient',
];

export const D2_DIRECTIONS = ['up', 'down', 'left', 'right'];

export const D2_BOOLEANS = ['true', 'false'];

/** Arrowhead shapes per the D2 tour (connections guide). */
export const D2_ARROWHEADS = [
  'triangle',
  'arrow',
  'diamond',
  'circle',
  'box',
  'cf-one',
  'cf-one-required',
  'cf-many',
  'cf-many-required',
  'cross',
  'none',
];

/** Keys whose value is free text / a URL / a number — never suggest into. */
const FREE_TEXT_KEYS = new Set([
  'label',
  'tooltip',
  'link',
  'icon',
  'width',
  'height',
  'top',
  'bottom',
  'left',
  'right',
  'grid-rows',
  'grid-columns',
  'grid-gap',
  'opacity',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dash',
  'font-size',
  'font',
  'font-color',
  'fill-pattern',
  'stroke-gradient',
]);

/** Keys whose value references another node key. */
const NODE_REF_KEYS = new Set(['near', 'constraint']);

const RESERVED_WORDS = new Set([
  ...D2_KEYWORDS,
  ...D2_SHAPES,
  ...D2_DIRECTIONS,
  ...D2_BOOLEANS,
]);

const CONNECTION_OP = /(->|<->|<-|--)/;

const KEY_PATTERN = /[A-Za-z_][\w\-.]*$/;

export type D2SuggestionKind =
  'shape' | 'keyword' | 'property' | 'value' | 'identifier' | 'snippet';

export interface D2Suggestion {
  label: string;
  kind: D2SuggestionKind;
  insertText: string;
  detail: string;
  documentation?: string;
  /** Lexicographic rank inside the suggest widget (`0_` first). */
  sortText: string;
  isSnippet?: boolean;
}

const DOCS: Record<string, string> = {
  shape: 'Sets the node shape (e.g. `shape: rectangle`).',
  style: 'Opens a style block or prefix (`style.fill: red`).',
  label: 'Display text for the node or connection.',
  direction: 'Layout direction: `up`, `down`, `left` or `right`.',
  link: 'URL opened when the node is clicked.',
  tooltip: 'Hover text for the node.',
  icon: 'Icon image URL rendered inside the node.',
  constraint: 'Pins a node relative to another key.',
  near: 'Places this node next to another node key.',
  width: 'Fixed node width in pixels.',
  height: 'Fixed node height in pixels.',
  'grid-rows': 'Number of rows for a grid container.',
  'grid-columns': 'Number of columns for a grid container.',
  'grid-gap': 'Gap between grid cells in pixels.',
  'source-arrowhead': 'Arrowhead shape at the connection start.',
  'target-arrowhead': 'Arrowhead shape at the connection end.',
  opacity: 'Transparency from 0 to 1.',
  fill: 'Background fill color.',
  stroke: 'Border color.',
  'stroke-width': 'Border width in pixels.',
  'stroke-dash': 'Dashed border pattern (e.g. `3 2`).',
  'font-size': 'Label font size in pixels.',
  'font-color': 'Label font color.',
  bold: 'Bold label text.',
  italic: 'Italic label text.',
  underline: 'Underlined label text.',
  shadow: 'Drop shadow behind the node.',
  multiple: 'Renders the node as a stacked set.',
  animated: 'Animates the node border.',
  'border-radius': 'Rounded corner radius in pixels.',
  '3d': 'Renders the node with a 3D effect.',
  'double-border': 'Renders a double border.',
};

export type D2CompletionContext =
  | { type: 'none' }
  | { type: 'connection' }
  | { type: 'style-value'; keyPath: string }
  | { type: 'shape-value' }
  | { type: 'direction-value' }
  | { type: 'arrowhead-value' }
  | { type: 'icon-value' }
  | { type: 'node-ref-value'; keyPath: string }
  | { type: 'key'; parentKey: string | null };

function indentOf(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

/**
 * Nearest enclosing block key: the first non-blank line above with a smaller
 * indent that opens a block (`key: {`). Indentation is compared by raw
 * whitespace length so mixed tabs/spaces still work.
 */
export function findParentKey(
  lines: string[],
  lineIndex: number,
): string | null {
  const current = lines[lineIndex] ?? '';
  if (current.trim() === '') {
    // Blank line: inherit the previous non-blank line's depth.
    let probe = lineIndex - 1;
    while (probe >= 0 && (lines[probe] ?? '').trim() === '') probe--;
    if (probe < 0) return null;
    const prev = lines[probe] ?? '';
    const match = prev.match(/^\s*([A-Za-z_][\w\-.]*)\s*:\s*\{\s*$/);
    return match ? match[1] : findParentKey(lines, probe);
  }
  const depth = indentOf(current);
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (indentOf(line) >= depth) continue;
    const match = line.match(/^\s*([A-Za-z_][\w\-.]*)\s*:\s*\{\s*$/);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Classify the cursor position. `lineIndex` is 0-based, `column` is a
 * 1-based Monaco column (characters before the cursor = `column - 1`).
 */
export function getCompletionContext(
  lines: string[],
  lineIndex: number,
  column: number,
): D2CompletionContext {
  const line = lines[lineIndex] ?? '';
  const prefix = line.slice(0, Math.max(0, column - 1));

  // Walk the prefix tracking string/comment state: a `#` outside strings
  // starts a comment, and an unclosed quote means free text — no suggestions.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    const prev = i > 0 ? prefix[i - 1] : '';
    if (ch === '#' && !inSingle && !inDouble) return { type: 'none' };
    if (ch === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (ch === "'" && !inDouble && prev !== '\\') inSingle = !inSingle;
  }
  if (inSingle || inDouble) return { type: 'none' };

  // Connection: `a -> |`, `a -> b: |`, chained `a -> b -> |`.
  if (CONNECTION_OP.test(prefix)) return { type: 'connection' };

  // Key path: segment after the last `;` (D2 statement separator).
  const segment = (prefix.split(';').pop() ?? '').trim();
  const colonIdx = segment.indexOf(':');
  if (colonIdx >= 0) {
    const keyPath = segment.slice(0, colonIdx).trim().toLowerCase();
    const last = keyPath.split('.').pop() ?? '';
    if (keyPath === 'shape' || last === 'shape') return { type: 'shape-value' };
    if (keyPath === 'direction') return { type: 'direction-value' };
    if (keyPath === 'icon' || last === 'icon') return { type: 'icon-value' };
    if (last === 'source-arrowhead' || last === 'target-arrowhead') {
      return { type: 'arrowhead-value' };
    }
    if (keyPath === 'style' || keyPath.startsWith('style.')) {
      return { type: 'style-value', keyPath };
    }
    if (NODE_REF_KEYS.has(last)) {
      return { type: 'node-ref-value', keyPath };
    }
    const parentKey = findParentKey(lines, lineIndex);
    if (parentKey === 'style') return { type: 'style-value', keyPath };
    if (FREE_TEXT_KEYS.has(last)) return { type: 'none' };
    // Unknown key in value position (e.g. `server: Web |`) — free text.
    return { type: 'none' };
  }

  // Typing a key: `style.fi|` narrows style props; a bare word is a new key.
  const word = (segment.match(KEY_PATTERN)?.[0] ?? '').toLowerCase();
  if (word === 'style' || word.startsWith('style.')) {
    return { type: 'style-value', keyPath: word };
  }
  const parentKey = findParentKey(lines, lineIndex);
  if (parentKey === 'style') return { type: 'style-value', keyPath: word };
  return { type: 'key', parentKey };
}

const MAX_IDENTIFIER_SCAN_LINES = 2000;

/**
 * Node keys already defined in the document: block/field keys at line starts
 * plus keys referenced around connection operators. Reserved D2 words are
 * excluded so they never double up with keyword suggestions.
 */
export function collectDefinedIdentifiers(fullText: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (name: string) => {
    if (!RESERVED_WORDS.has(name.toLowerCase()) && !seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  };
  const lines = fullText.split('\n').slice(0, MAX_IDENTIFIER_SCAN_LINES);
  for (const line of lines) {
    const head = line.match(/^\s*([A-Za-z_][\w\-.]*)\s*(?::|\{|->|<->|<-|--)/);
    if (head) push(head[1]);
    const opGlobal = /(?:->|<->|<-|--)\s*([A-Za-z_][\w\-.]*)/g;
    for (const match of line.matchAll(opGlobal)) push(match[1]);
  }
  return ordered;
}

export interface D2SnippetDef {
  label: string;
  detail: string;
  insertText: string;
}

export const D2_SNIPPETS: D2SnippetDef[] = [
  {
    label: 'connection',
    detail: 'D2 Connection',
    insertText: '${1:source} -> ${2:target}: ${3:label}',
  },
  {
    label: 'bidirectional',
    detail: 'D2 Bidirectional Connection',
    insertText: '${1:source} <-> ${2:target}: ${3:label}',
  },
  {
    label: 'container',
    detail: 'D2 Container',
    insertText: '${1:name}: {\n  ${2:child1}\n  ${3:child2}\n}',
  },
  {
    label: 'style block',
    detail: 'D2 Style Block',
    insertText: 'style: {\n  ${1:property}: ${2:value}\n}',
  },
  {
    label: 'sql_table',
    detail: 'D2 SQL Table',
    insertText:
      '${1:table}: {\n  shape: sql_table\n  ${2:id}: int\n  ${3:name}: varchar\n}',
  },
  {
    label: 'sequence_diagram',
    detail: 'D2 Sequence Diagram',
    insertText:
      '${1:diagram}: {\n  shape: sequence_diagram\n  ${2:alice} -> ${3:bob}: ${4:label}\n}',
  },
  {
    label: 'grid',
    detail: 'D2 Grid Container',
    insertText:
      '${1:grid}: {\n  grid-rows: ${2:2}\n  grid-columns: ${3:3}\n  ${4:child1}\n}',
  },
];

function shapeSuggestions(): D2Suggestion[] {
  return D2_SHAPES.map((shape) => ({
    label: shape,
    kind: 'shape' as const,
    insertText: shape,
    detail: 'D2 Shape',
    sortText: `2_${shape}`,
  }));
}

function keywordSuggestions(): D2Suggestion[] {
  return D2_KEYWORDS.map((kw) => ({
    label: kw,
    kind: 'keyword' as const,
    insertText: kw,
    detail: 'D2 Keyword',
    documentation: DOCS[kw],
    sortText: `0_${kw}`,
  }));
}

function propertySuggestions(): D2Suggestion[] {
  return D2_STYLE_PROPS.map((prop) => ({
    label: prop,
    kind: 'property' as const,
    insertText: prop,
    detail: 'D2 Style Property',
    documentation: DOCS[prop],
    sortText: `0_${prop}`,
  }));
}

function identifierSuggestions(names: string[]): D2Suggestion[] {
  return names.map((name) => ({
    label: name,
    kind: 'identifier' as const,
    insertText: name,
    detail: 'Defined node',
    sortText: `1_${name}`,
  }));
}

function valueSuggestions(values: string[], detail: string): D2Suggestion[] {
  return values.map((value) => ({
    label: value,
    kind: 'value' as const,
    insertText: value,
    detail,
    sortText: `0_${value}`,
  }));
}

function snippetSuggestions(): D2Suggestion[] {
  return D2_SNIPPETS.map((snippet) => ({
    label: snippet.label,
    kind: 'snippet' as const,
    insertText: snippet.insertText,
    detail: snippet.detail,
    sortText: `3_${snippet.label}`,
    isSnippet: true,
  }));
}

function iconSuggestions(): D2Suggestion[] {
  return STENCILS.map((s) => ({
    label: s.id,
    kind: 'value' as const,
    insertText: s.id,
    detail: `${s.name} (${s.category.toUpperCase()})`,
    documentation: s.defaultDetail,
    sortText: `0_${s.category}_${s.name}`,
  }));
}

export function buildSuggestions(
  context: D2CompletionContext,
  definedIdentifiers: string[],
): D2Suggestion[] {
  switch (context.type) {
    case 'none':
      return [];
    case 'connection':
    case 'node-ref-value':
      return identifierSuggestions(definedIdentifiers);
    case 'shape-value':
      return shapeSuggestions();
    case 'direction-value':
      return valueSuggestions(D2_DIRECTIONS, 'D2 Direction');
    case 'arrowhead-value':
      return valueSuggestions(D2_ARROWHEADS, 'D2 Arrowhead');
    case 'icon-value':
      return iconSuggestions();
    case 'style-value':
      return propertySuggestions();
    case 'key':
      return [
        ...keywordSuggestions(),
        ...identifierSuggestions(definedIdentifiers),
        ...shapeSuggestions(),
        ...snippetSuggestions(),
      ];
  }
}
