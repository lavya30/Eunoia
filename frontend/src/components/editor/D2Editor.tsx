'use client';

import React, { useCallback } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import { registerD2Language } from './d2Language';

interface D2EditorProps {
  /** Current D2 source code */
  value: string;
  /** Fires on every keystroke with the new source text */
  onChange: (value: string) => void;
  /** Lock the editor for read-only viewing */
  readOnly?: boolean;
}

/**
 * Monaco-backed D2 code editor with custom syntax highlighting,
 * autocomplete, and Eunoia's dark theme.
 */
export const D2Editor: React.FC<D2EditorProps> = ({
  value,
  onChange,
  readOnly = false,
}) => {
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    registerD2Language(monaco);
  }, []);

  const handleChange = useCallback(
    (val: string | undefined) => {
      onChange(val ?? '');
    },
    [onChange],
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0D0D0D',
        overflow: 'hidden',
      }}
    >
      {/* Loading spinner shown while Monaco WASM loads */}
      <Editor
        height="100%"
        defaultLanguage="d2"
        language="d2"
        theme="eunoia-d2-dark"
        value={value}
        onChange={handleChange}
        beforeMount={handleBeforeMount}
        loading={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#636D83',
              fontSize: 13,
              fontFamily: "'Inter', sans-serif",
              gap: 8,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              style={{ animation: 'spin 1s linear infinite' }}
            >
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="28"
                strokeDashoffset="8"
                strokeLinecap="round"
              />
            </svg>
            Loading editor…
          </div>
        }
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily:
            "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
          fontLigatures: true,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly,
          tabSize: 2,
          wordWrap: 'on',
          padding: { top: 16, bottom: 16 },
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          renderLineHighlight: 'gutter',
          bracketPairColorization: { enabled: true },
          guides: {
            indentation: true,
            bracketPairs: true,
          },
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
            useShadows: false,
          },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          contextmenu: true,
          suggest: {
            showWords: false,
          },
        }}
      />
    </div>
  );
};
