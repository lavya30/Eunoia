import type { Monaco } from '@monaco-editor/react';

/**
 * Registers the D2 language with Monaco Editor.
 * Includes Monarch tokenizer for syntax highlighting and a custom dark theme.
 */
export function registerD2Language(monaco: Monaco) {
  // Only register once
  if (
    monaco.languages
      .getLanguages()
      .some((lang: { id: string }) => lang.id === 'd2')
  ) {
    return;
  }

  monaco.languages.register({ id: 'd2' });

  // Monarch tokenizer for D2 syntax
  monaco.languages.setMonarchTokensProvider('d2', {
    defaultToken: '',
    tokenPostfix: '.d2',

    keywords: [
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
    ],

    shapes: [
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
    ],

    directions: ['up', 'down', 'left', 'right'],

    booleans: ['true', 'false'],

    tokenizer: {
      root: [
        // Block comments (not standard D2, but useful)
        [/"""/, 'comment', '@blockComment'],

        // Line comments
        [/#.*$/, 'comment'],

        // Pipe-delimited text blocks
        [/\|/, 'string.delimiter', '@pipeString'],

        // Connectors — must be before identifier rules
        [/<->/, 'operator.connector'],
        [/->/, 'operator.connector'],
        [/<-/, 'operator.connector'],
        [/--/, 'operator.connector'],

        // Colon separator
        [/:/, 'delimiter'],

        // Semicolon
        [/;/, 'delimiter'],

        // Dot accessor
        [/\./, 'delimiter.dot'],

        // Strings (double-quoted)
        [/"/, 'string', '@string'],

        // Strings (single-quoted)
        [/'/, 'string', '@stringSingle'],

        // Numbers
        [/\d+/, 'number'],

        // Identifiers and keyword matching
        [
          /[a-zA-Z_][\w-]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@shapes': 'type.shape',
              '@directions': 'constant.direction',
              '@booleans': 'constant.boolean',
              '@default': 'identifier',
            },
          },
        ],

        // Brackets
        [/[{}]/, '@brackets'],
        [/[[\]]/, '@brackets'],
        [/[()]/, '@brackets'],

        // Whitespace
        [/\s+/, 'white'],
      ],

      string: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      stringSingle: [
        [/[^'\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],

      pipeString: [
        [/[^|]+/, 'string'],
        [/\|/, 'string.delimiter', '@pop'],
      ],

      blockComment: [
        [/"""/, 'comment', '@pop'],
        [/./, 'comment'],
      ],
    },
  });

  // D2 dark theme — matches Eunoia's dark aesthetic
  monaco.editor.defineTheme('eunoia-d2-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C678DD', fontStyle: 'bold' },
      { token: 'type.shape', foreground: '56B6C2' },
      { token: 'constant.direction', foreground: 'D19A66' },
      { token: 'constant.boolean', foreground: 'D19A66' },
      { token: 'identifier', foreground: 'ABB2BF' },
      { token: 'operator.connector', foreground: '61AFEF', fontStyle: 'bold' },
      { token: 'delimiter', foreground: '636D83' },
      { token: 'delimiter.dot', foreground: '636D83' },
      { token: 'string', foreground: '98C379' },
      { token: 'string.escape', foreground: '56B6C2' },
      { token: 'string.delimiter', foreground: '98C379' },
      { token: 'number', foreground: 'D19A66' },
      { token: '@brackets', foreground: 'ABB2BF' },
    ],
    colors: {
      'editor.background': '#0D0D0D',
      'editor.foreground': '#ABB2BF',
      'editorLineNumber.foreground': '#3B3F4A',
      'editorLineNumber.activeForeground': '#636D83',
      'editor.lineHighlightBackground': '#1A1A1A',
      'editor.selectionBackground': '#3E4451',
      'editorCursor.foreground': '#61AFEF',
      'editorIndentGuide.background': '#1A1A1A',
      'editorIndentGuide.activeBackground': '#3B3F4A',
      'editorWidget.background': '#141414',
      'editorWidget.border': '#2A2A2A',
      'editorSuggestWidget.background': '#141414',
      'editorSuggestWidget.border': '#2A2A2A',
      'editorSuggestWidget.selectedBackground': '#1E1E1E',
      'scrollbarSlider.background': '#2A2A2A80',
      'scrollbarSlider.hoverBackground': '#3B3F4A80',
      'scrollbarSlider.activeBackground': '#3B3F4AA0',
    },
  });

  // Basic D2 autocompletions
  monaco.languages.registerCompletionItemProvider('d2', {
    provideCompletionItems: (
      model: Parameters<
        Parameters<
          typeof monaco.languages.registerCompletionItemProvider
        >[1]['provideCompletionItems']
      >[0],
      position: Parameters<
        Parameters<
          typeof monaco.languages.registerCompletionItemProvider
        >[1]['provideCompletionItems']
      >[1],
    ) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        // Shape types
        ...[
          'rectangle',
          'square',
          'cylinder',
          'circle',
          'diamond',
          'oval',
          'hexagon',
          'cloud',
          'person',
          'package',
          'queue',
          'sql_table',
          'class',
          'code',
          'text',
          'sequence_diagram',
        ].map((shape) => ({
          label: shape,
          kind: monaco.languages.CompletionItemKind.Enum,
          insertText: shape,
          detail: 'D2 Shape',
          range,
        })),
        // Style keywords
        ...[
          'style',
          'shape',
          'label',
          'direction',
          'link',
          'tooltip',
          'icon',
          'near',
          'width',
          'height',
        ].map((kw) => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          detail: 'D2 Keyword',
          range,
        })),
        // Style properties
        ...[
          'fill',
          'stroke',
          'stroke-width',
          'stroke-dash',
          'opacity',
          'font-size',
          'font-color',
          'shadow',
          'bold',
          'italic',
          'underline',
          'border-radius',
          'animated',
          '3d',
          'double-border',
          'multiple',
        ].map((prop) => ({
          label: prop,
          kind: monaco.languages.CompletionItemKind.Property,
          insertText: prop,
          detail: 'D2 Style Property',
          range,
        })),
        // Connectors snippet
        {
          label: 'connection (->)',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '${1:source} -> ${2:target}: ${3:label}',
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'D2 Connection',
          range,
        },
        {
          label: 'bidirectional (<->)',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '${1:source} <-> ${2:target}: ${3:label}',
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'D2 Bidirectional Connection',
          range,
        },
        // Container snippet
        {
          label: 'container',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '${1:name}: {\n  ${2:child1}\n  ${3:child2}\n}',
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'D2 Container',
          range,
        },
      ];

      return { suggestions };
    },
  });
}
