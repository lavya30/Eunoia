'use client';

import { Code2, PanelRight, Sparkles } from 'lucide-react';
import { D2Editor } from '@/components/editor';
import type { D2Diagnostic } from '@/lib/whiteboard/d2-diagnostics';

type D2PanelProps = {
  code: string;
  onCodeChange: (value: string) => void;
  compileState: 'saved' | 'draft' | 'compiled' | 'compiling';
  engine: 'dagre' | 'elk' | 'tala';
  onSelectEngine: (next: 'dagre' | 'elk' | 'tala') => void;
  onCompile: () => void;
  onClose: () => void;
  diagnostics: D2Diagnostic[];
  aiPrompt: string;
  onAiPromptChange: (value: string) => void;
  aiBusy: boolean;
  aiQuota: { used: number; limit: number } | null;
  jevWarnings?: string[];
  onGenerate: () => void;
  onSuggestLayout: () => void;
};

/**
 * D2 source panel: AI prompt row + Monaco editor + layout engine +
 * compile footer. Extracted from WhiteboardPage.
 */
export function D2Panel({
  code,
  onCodeChange,
  compileState,
  engine,
  onSelectEngine,
  onCompile,
  onClose,
  diagnostics,
  aiPrompt,
  onAiPromptChange,
  aiBusy,
  aiQuota,
  jevWarnings = [],
  onGenerate,
  onSuggestLayout,
}: D2PanelProps) {
  return (
    <aside className="code-panel" aria-label="D2 code editor">
      <div className="code-panel-header">
        <div className="code-panel-heading">
          <div className="code-icon">
            <Code2 size={16} />
          </div>
          <div>
            <span className="code-panel-title">D2 source</span>
            <span className="code-panel-subtitle">native diagram layer</span>
          </div>
        </div>
        <button
          className="code-close"
          type="button"
          aria-label="Close D2 editor"
          title="Close D2 editor"
          onClick={onClose}
        >
          <PanelRight size={16} />
        </button>
      </div>
      <div className="code-panel-status">
        <span className={`code-status-dot code-status-dot--${compileState}`} />
        <span>
          {compileState === 'draft'
            ? 'Draft changes'
            : compileState === 'compiling'
              ? 'Compiling…'
              : compileState === 'compiled'
                ? 'Compiled successfully'
                : 'Ready to compile'}
        </span>
        <span className="code-line-count">{code.split('\n').length} lines</span>
        {diagnostics.length > 0 ? (
          <span
            className="code-line-count"
            role="status"
            title={diagnostics[0].message}
            style={{ color: '#e5484d' }}
          >
            {diagnostics.length} error{diagnostics.length === 1 ? '' : 's'} ·
            line {diagnostics[0].line}
          </span>
        ) : null}
      </div>
      <form
        className="code-ai-row"
        style={{ display: 'flex', gap: 8, padding: '8px 12px' }}
        onSubmit={(event) => {
          event.preventDefault();
          onGenerate();
        }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <Sparkles
            size={14}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              opacity: 0.55,
              pointerEvents: 'none',
            }}
          />
          <input
            aria-label="Describe a diagram to generate"
            placeholder="Describe a diagram… (AI)"
            value={aiPrompt}
            maxLength={4000}
            disabled={aiBusy}
            onChange={(event) => onAiPromptChange(event.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px 8px 30px',
              borderRadius: 10,
              border: '1px solid #e3e2ea',
              fontSize: 13,
            }}
          />
        </div>
        <button
          type="submit"
          className="compile-button"
          disabled={aiBusy || !aiPrompt.trim()}
          title={
            aiQuota
              ? `AI quota: ${aiQuota.used}/${aiQuota.limit} this month`
              : 'Generate D2 from description'
          }
        >
          {aiBusy ? 'Dreaming…' : 'Generate'}
        </button>
        <button
          type="button"
          className="compile-button"
          disabled={aiBusy || !code.trim()}
          onClick={onSuggestLayout}
          title={
            aiQuota
              ? `AI quota: ${aiQuota.used}/${aiQuota.limit} this month`
              : 'Suggest a better layout for the current diagram'
          }
        >
          {aiBusy ? '…' : 'Suggest layout'}
        </button>
      </form>
      {jevWarnings.length > 0 ? (
        <div
          role="status"
          aria-label="AI quality warnings"
          style={{
            margin: '0 12px',
            padding: '6px 10px',
            borderRadius: 8,
            background: '#fff8e6',
            border: '1px solid #f0d48a',
            fontSize: 12,
            color: '#7a5b00',
          }}
        >
          {jevWarnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
      <div className="code-editor-wrap">
        <D2Editor
          value={code}
          onChange={onCodeChange}
          diagnostics={diagnostics}
        />
      </div>
      <div className="code-panel-footer">
        <div className="code-footer-copy">
          <span className="code-key">⌘</span>
          <span>Changes compile after a short pause</span>
        </div>
        <label className="engine-picker">
          <span className="engine-picker-label">Layout</span>
          <select
            aria-label="Layout engine"
            value={engine}
            onChange={(event) =>
              onSelectEngine(event.target.value as 'dagre' | 'elk' | 'tala')
            }
          >
            <option value="dagre">Dagre</option>
            <option value="elk">ELK</option>
            <option value="tala">Tala</option>
          </select>
        </label>
        <button
          className="compile-button"
          type="button"
          onClick={onCompile}
          disabled={compileState === 'compiling'}
        >
          <span className="compile-button__dot" />
          Compile
        </button>
      </div>
    </aside>
  );
}
