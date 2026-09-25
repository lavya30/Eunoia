'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardNode } from '@/lib/whiteboard/board-types';

const MAX_RESULTS = 30;

export function SearchPalette({
  nodes,
  onJump,
  onClose,
}: {
  nodes: BoardNode[];
  onJump: (node: BoardNode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return nodes.slice(0, MAX_RESULTS);
    return nodes
      .filter(
        (node) =>
          node.label.toLowerCase().includes(needle) ||
          node.detail.toLowerCase().includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [nodes, query]);

  return (
    <aside className="history-panel" aria-label="Search board">
      <div className="history-panel-header">
        <strong>Search board</strong>
        <button
          type="button"
          className="header-icon-button"
          aria-label="Close search"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <input
        ref={inputRef}
        className="room-gate-input"
        type="search"
        placeholder="Search node labels…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          else if (event.key === 'Enter' && results[0]) onJump(results[0]);
        }}
      />
      {results.length === 0 ? (
        <p className="history-panel-empty">No matching nodes.</p>
      ) : (
        <ul className="history-panel-list">
          {results.map((node) => (
            <li key={node.id} className="history-panel-row">
              <div className="history-panel-meta">
                <span>{node.label || '(untitled)'}</span>
                <span className="history-panel-sub">
                  {node.shape ?? 'shape'}
                  {node.detail ? ` · ${node.detail.slice(0, 60)}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="history-panel-restore"
                onClick={() => onJump(node)}
              >
                Go
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
