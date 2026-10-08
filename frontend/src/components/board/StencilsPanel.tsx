'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, X } from 'lucide-react';
import {
  STENCIL_CATEGORIES,
  searchStencils,
  type StencilCategory,
  type StencilDefinition,
} from '@/lib/whiteboard/stencils';

export interface StencilsPanelProps {
  onSelect: (stencil: StencilDefinition) => void;
  onClose: () => void;
}

export function StencilsPanel({ onSelect, onClose }: StencilsPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<
    StencilCategory | 'all'
  >('all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const items = useMemo(() => {
    return searchStencils(query, selectedCategory);
  }, [query, selectedCategory]);

  return (
    <aside
      className="stencils-panel"
      aria-label="Architecture Stencils Library"
    >
      <div className="stencils-panel-header">
        <div className="stencils-panel-title">
          <Boxes size={18} className="stencils-panel-title-icon" />
          <span>Architecture Stencils</span>
          <span className="stencils-count-badge">{items.length}</span>
        </div>
        <button
          type="button"
          className="stencils-close-btn"
          aria-label="Close stencils panel"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className="stencils-search-wrapper">
        <Search size={15} className="stencils-search-icon" />
        <input
          ref={inputRef}
          type="search"
          className="stencils-search-input"
          placeholder="Search stencils (e.g. S3, K8s, Postgres)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="stencils-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="stencils-categories-row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === 'all'}
          className={`stencils-category-pill ${selectedCategory === 'all' ? 'is-active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          All
        </button>
        {STENCIL_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={selectedCategory === cat.id}
            className={`stencils-category-pill ${selectedCategory === cat.id ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="stencils-grid-container">
        {items.length === 0 ? (
          <div className="stencils-empty-state">
            <Boxes size={28} opacity={0.4} />
            <p>No stencils found for &ldquo;{query}&rdquo;</p>
            <button
              type="button"
              className="stencils-reset-btn"
              onClick={() => {
                setQuery('');
                setSelectedCategory('all');
              }}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="stencils-grid">
            {items.map((stencil) => (
              <button
                key={stencil.id}
                type="button"
                className="stencil-card"
                draggable
                title={`${stencil.name} — ${stencil.defaultDetail}\nClick or drag to canvas`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/json',
                    JSON.stringify({
                      type: 'stencil',
                      id: stencil.id,
                    }),
                  );
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onSelect(stencil)}
              >
                <div
                  className="stencil-icon-preview"
                  style={{ borderColor: `${stencil.color}40` }}
                >
                  <svg
                    viewBox={stencil.viewBox}
                    width="26"
                    height="26"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: stencil.body }}
                  />
                </div>
                <div className="stencil-card-meta">
                  <span className="stencil-card-name">{stencil.name}</span>
                  <span className="stencil-card-detail">
                    {stencil.defaultDetail}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stencils-panel-footer">
        <span>💡 Click to add at center or drag onto canvas</span>
      </div>
    </aside>
  );
}
