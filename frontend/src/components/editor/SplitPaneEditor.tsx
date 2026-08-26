'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { D2Editor } from './D2Editor';

/* ─── Sample D2 code shown when the editor first opens ─── */
const DEFAULT_D2_CODE = `# Eunoia — Architecture Diagram

server: {
  label: "API Server"
  shape: rectangle

  style: {
    fill: "#1a1a2e"
    stroke: "#61AFEF"
    border-radius: 8
    font-color: "#ABB2BF"
  }
}

database: {
  label: "PostgreSQL"
  shape: cylinder

  style: {
    fill: "#162447"
    stroke: "#56B6C2"
    font-color: "#ABB2BF"
  }
}

client: {
  label: "Next.js Client"
  shape: rectangle

  style: {
    fill: "#1b1b2f"
    stroke: "#C678DD"
    border-radius: 8
    font-color: "#ABB2BF"
  }
}

client -> server: "WebSocket (Yjs)" {
  style: {
    stroke: "#61AFEF"
    animated: true
  }
}

server -> database: "Prisma ORM" {
  style: {
    stroke: "#56B6C2"
  }
}
`;

/* ─── Constants ─── */
const MIN_EDITOR_WIDTH = 240;
const MAX_EDITOR_WIDTH = 900;
const DEFAULT_EDITOR_WIDTH = 400;
const DIVIDER_WIDTH = 6;

/* ─── Styles (inline to keep the component self-contained) ─── */
const styles = {
  container: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#080808',
    color: '#ABB2BF',
    userSelect: 'none' as const,
  },

  editorPane: (width: number) => ({
    width,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#0D0D0D',
    borderRight: '1px solid #1A1A1A',
    transition: 'width 0.05s ease-out',
  }),

  editorHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    padding: '0 14px',
    backgroundColor: '#0D0D0D',
    borderBottom: '1px solid #1A1A1A',
    flexShrink: 0,
  },

  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: '#636D83',
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    fontFamily: "'Inter', system-ui, sans-serif",
  },

  headerDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: '#98C379',
  },

  editorBody: {
    flex: 1,
    overflow: 'hidden',
  },

  divider: (isDragging: boolean) => ({
    width: DIVIDER_WIDTH,
    height: '100%',
    flexShrink: 0,
    cursor: 'col-resize',
    backgroundColor: isDragging ? '#61AFEF' : '#141414',
    transition: isDragging ? 'none' : 'background-color 0.15s ease',
    position: 'relative' as const,
    zIndex: 10,
  }),

  dividerHoverZone: {
    position: 'absolute' as const,
    top: 0,
    left: -4,
    right: -4,
    bottom: 0,
  },

  collapseButton: (isCollapsed: boolean) => ({
    position: 'absolute' as const,
    top: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: '1px solid #2A2A2A',
    backgroundColor: '#141414',
    color: '#636D83',
    fontSize: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 20,
    transition: 'all 0.15s ease',
    lineHeight: 1,
    padding: 0,
    ...(isCollapsed ? {} : {}),
  }),

  canvasPane: {
    flex: 1,
    height: '100%',
    position: 'relative' as const,
    overflow: 'hidden',
    backgroundColor: '#0A0A0A',
  },

  canvasPlaceholder: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 16,
    color: '#3B3F4A',
    fontFamily: "'Inter', system-ui, sans-serif",
  },

  canvasGrid: {
    position: 'absolute' as const,
    inset: 0,
    backgroundImage: 'radial-gradient(circle, #1A1A1A 1px, transparent 1px)',
    backgroundSize: '24px 24px',
    opacity: 0.5,
  },

  canvasText: {
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '0.02em',
  },

  canvasSubtext: {
    fontSize: 12,
    opacity: 0.5,
  },
} as const;

/* ─── Component ─── */
interface SplitPaneEditorProps {
  /** Initial D2 source code; falls back to the built-in sample */
  initialCode?: string;
  /** Called (debounced by the parent) whenever the code changes */
  onCodeChange?: (code: string) => void;
  /** The canvas or diagram preview — rendered in the right pane */
  children?: React.ReactNode;
}

export const SplitPaneEditor: React.FC<SplitPaneEditorProps> = ({
  initialCode,
  onCodeChange,
  children,
}) => {
  const [code, setCode] = useState(initialCode ?? DEFAULT_D2_CODE);
  const [editorWidth, setEditorWidth] = useState(DEFAULT_EDITOR_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Drag-to-resize logic ── */
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      setEditorWidth(Math.min(MAX_EDITOR_WIDTH, Math.max(MIN_EDITOR_WIDTH, x)));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /* ── Code change handler ── */
  const handleCodeChange = useCallback(
    (val: string) => {
      setCode(val);
      onCodeChange?.(val);
    },
    [onCodeChange],
  );

  /* ── Collapse / expand toggle ── */
  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  /* ── Prevent text selection while dragging ── */
  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  return (
    <div ref={containerRef} style={styles.container}>
      {/* ── Editor Pane ── */}
      {!isCollapsed && (
        <div style={styles.editorPane(editorWidth)}>
          {/* Header bar */}
          <div style={styles.editorHeader}>
            <div style={styles.headerTitle}>
              <div style={styles.headerDot} />
              D2 Editor
            </div>
            <span
              style={{
                fontSize: 11,
                color: '#3B3F4A',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {code.split('\n').length} lines
            </span>
          </div>

          {/* Monaco editor body */}
          <div style={styles.editorBody}>
            <D2Editor value={code} onChange={handleCodeChange} />
          </div>
        </div>
      )}

      {/* ── Draggable Divider ── */}
      <div
        style={styles.divider(isDragging)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div style={styles.dividerHoverZone} />
        <button
          onClick={toggleCollapse}
          style={styles.collapseButton(isCollapsed)}
          title={isCollapsed ? 'Open editor' : 'Collapse editor'}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isCollapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* ── Canvas / Preview Pane ── */}
      <div style={styles.canvasPane}>
        {children ?? (
          <>
            <div style={styles.canvasGrid} />
            <div style={styles.canvasPlaceholder}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span style={styles.canvasText}>Infinite Canvas</span>
              <span style={styles.canvasSubtext}>
                D2 diagrams will render here
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
