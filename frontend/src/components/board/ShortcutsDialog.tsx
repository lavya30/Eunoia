'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Command,
  HelpCircle,
  Layers,
  MousePointer,
  Move,
  Pencil,
  Search,
  X,
} from 'lucide-react';

export type ShortcutCategory = 'all' | 'tools' | 'canvas' | 'edit' | 'arrange';

export interface ShortcutItem {
  id: string;
  category: 'tools' | 'canvas' | 'edit' | 'arrange';
  title: string;
  description?: string;
  macKeys: string[];
  winKeys: string[];
}

const SHORTCUTS: ShortcutItem[] = [
  // Tools
  {
    id: 'tool-select',
    category: 'tools',
    title: 'Select / Pointer',
    description: 'Select, move, and inspect elements',
    macKeys: ['V'],
    winKeys: ['V'],
  },
  {
    id: 'tool-hand',
    category: 'tools',
    title: 'Hand / Pan',
    description: 'Pan around the infinite canvas',
    macKeys: ['H'],
    winKeys: ['H'],
  },
  {
    id: 'tool-rectangle',
    category: 'tools',
    title: 'Rectangle',
    description: 'Create boxes and rectangular cards',
    macKeys: ['R'],
    winKeys: ['R'],
  },
  {
    id: 'tool-diamond',
    category: 'tools',
    title: 'Diamond',
    description: 'Create decision diamonds',
    macKeys: ['M'],
    winKeys: ['M'],
  },
  {
    id: 'tool-ellipse',
    category: 'tools',
    title: 'Ellipse',
    description: 'Create circle and ellipse shapes',
    macKeys: ['E'],
    winKeys: ['E'],
  },
  {
    id: 'tool-arrow',
    category: 'tools',
    title: 'Arrow',
    description: 'Connect nodes with directional arrows',
    macKeys: ['A'],
    winKeys: ['A'],
  },
  {
    id: 'tool-line',
    category: 'tools',
    title: 'Line',
    description: 'Draw straight connecting lines',
    macKeys: ['L'],
    winKeys: ['L'],
  },
  {
    id: 'tool-draw',
    category: 'tools',
    title: 'Draw / Pencil',
    description: 'Freehand sketching with ink smoothing',
    macKeys: ['D'],
    winKeys: ['D'],
  },
  {
    id: 'tool-text',
    category: 'tools',
    title: 'Text',
    description: 'Place text blocks on the canvas',
    macKeys: ['T'],
    winKeys: ['T'],
  },
  {
    id: 'tool-frame',
    category: 'tools',
    title: 'Frame / Slide',
    description: 'Create slide frames and section boundaries',
    macKeys: ['F'],
    winKeys: ['F'],
  },
  {
    id: 'tool-laser',
    category: 'tools',
    title: 'Laser Pointer',
    description: 'Point and highlight live on canvas with glowing trail',
    macKeys: ['P'],
    winKeys: ['P'],
  },
  {
    id: 'tool-note',
    category: 'tools',
    title: 'Sticky Note',
    description: 'Place colored sticky notes',
    macKeys: ['N'],
    winKeys: ['N'],
  },
  {
    id: 'tool-eraser',
    category: 'tools',
    title: 'Eraser',
    description: 'Erase nodes and strokes by clicking',
    macKeys: ['X'],
    winKeys: ['X'],
  },

  // Canvas & View
  {
    id: 'canvas-presentation-mode',
    category: 'canvas',
    title: 'Presentation Mode',
    description: 'Fullscreen slide show navigating through frames',
    macKeys: ['⌥', 'P'],
    winKeys: ['Alt', 'P'],
  },
  {
    id: 'canvas-pan',
    category: 'canvas',
    title: 'Pan Canvas',
    description: 'Quick pan without changing active tool',
    macKeys: ['Space', 'Drag'],
    winKeys: ['Space', 'Drag'],
  },
  {
    id: 'canvas-zoom-in',
    category: 'canvas',
    title: 'Zoom In',
    description: 'Zoom closer into canvas content',
    macKeys: ['+'],
    winKeys: ['+'],
  },
  {
    id: 'canvas-zoom-out',
    category: 'canvas',
    title: 'Zoom Out',
    description: 'Zoom out to see wider canvas overview',
    macKeys: ['-'],
    winKeys: ['-'],
  },
  {
    id: 'canvas-reset-camera',
    category: 'canvas',
    title: 'Reset View (100%)',
    description: 'Reset zoom level to 100% at origin',
    macKeys: ['⌘', '0'],
    winKeys: ['Ctrl', '0'],
  },
  {
    id: 'canvas-toggle-minimap',
    category: 'canvas',
    title: 'Toggle Minimap',
    description: 'Show or hide the radar overview map',
    macKeys: ['⌘', 'M'],
    winKeys: ['Ctrl', 'M'],
  },
  {
    id: 'canvas-grid-mode',
    category: 'canvas',
    title: 'Cycle Grid Mode',
    description: 'Toggle between dots, lines, and plain background',
    macKeys: ['⌘', "'"],
    winKeys: ['Ctrl', "'"],
  },
  {
    id: 'canvas-search-board',
    category: 'canvas',
    title: 'Search Board Nodes',
    description: 'Open node search palette to jump to any item',
    macKeys: ['⌘', 'F'],
    winKeys: ['Ctrl', 'F'],
  },
  {
    id: 'canvas-scroll-zoom',
    category: 'canvas',
    title: 'Scroll to Zoom',
    description: 'Zoom in and out centered at the cursor',
    macKeys: ['Scroll'],
    winKeys: ['Scroll'],
  },

  // Edit & History
  {
    id: 'edit-undo',
    category: 'edit',
    title: 'Undo',
    description: 'Revert recent canvas action',
    macKeys: ['⌘', 'Z'],
    winKeys: ['Ctrl', 'Z'],
  },
  {
    id: 'edit-redo',
    category: 'edit',
    title: 'Redo',
    description: 'Re-apply reverted canvas action',
    macKeys: ['⌘', 'Shift', 'Z'],
    winKeys: ['Ctrl', 'Y'],
  },
  {
    id: 'edit-select-all',
    category: 'edit',
    title: 'Select All',
    description: 'Select all nodes on current board',
    macKeys: ['⌘', 'A'],
    winKeys: ['Ctrl', 'A'],
  },
  {
    id: 'edit-copy',
    category: 'edit',
    title: 'Copy Selected',
    description: 'Copy selected elements to board clipboard',
    macKeys: ['⌘', 'C'],
    winKeys: ['Ctrl', 'C'],
  },
  {
    id: 'edit-cut',
    category: 'edit',
    title: 'Cut Selected',
    description: 'Cut selected elements to board clipboard',
    macKeys: ['⌘', 'X'],
    winKeys: ['Ctrl', 'X'],
  },
  {
    id: 'edit-paste',
    category: 'edit',
    title: 'Paste',
    description: 'Paste copied items with offset onto canvas',
    macKeys: ['⌘', 'V'],
    winKeys: ['Ctrl', 'V'],
  },
  {
    id: 'edit-duplicate',
    category: 'edit',
    title: 'Duplicate',
    description: 'Quick clone selected elements in place',
    macKeys: ['⌘', 'D'],
    winKeys: ['Ctrl', 'D'],
  },
  {
    id: 'edit-delete',
    category: 'edit',
    title: 'Delete Selected',
    description: 'Remove selected elements from canvas',
    macKeys: ['Delete'],
    winKeys: ['Del / Backspace'],
  },
  {
    id: 'edit-enter',
    category: 'edit',
    title: 'Edit Selected Item',
    description: 'Open label or text editor on focused node',
    macKeys: ['Enter'],
    winKeys: ['Enter'],
  },
  {
    id: 'edit-escape',
    category: 'edit',
    title: 'Deselect / Cancel',
    description: 'Clear selection or dismiss active action',
    macKeys: ['Esc'],
    winKeys: ['Esc'],
  },
  {
    id: 'edit-multiselect',
    category: 'edit',
    title: 'Multi-select / Toggle',
    description: 'Add or remove elements from the selection',
    macKeys: ['Shift', 'Click'],
    winKeys: ['Shift', 'Click'],
  },
  {
    id: 'edit-shortcuts',
    category: 'edit',
    title: 'Open Shortcuts Cheatsheet',
    description: 'Toggle this keyboard shortcut dialog',
    macKeys: ['?'],
    winKeys: ['?'],
  },

  // Arrange & Layers
  {
    id: 'arrange-group',
    category: 'arrange',
    title: 'Group Selected',
    description: 'Lock multiple nodes into a single unit',
    macKeys: ['⌘', 'G'],
    winKeys: ['Ctrl', 'G'],
  },
  {
    id: 'arrange-ungroup',
    category: 'arrange',
    title: 'Ungroup Selected',
    description: 'Break grouped nodes back into individuals',
    macKeys: ['⌘', 'Shift', 'G'],
    winKeys: ['Ctrl', 'Shift', 'G'],
  },
  {
    id: 'arrange-bring-forward',
    category: 'arrange',
    title: 'Bring Forward',
    description: 'Step element one layer up in stacking order',
    macKeys: [']'],
    winKeys: [']'],
  },
  {
    id: 'arrange-bring-to-front',
    category: 'arrange',
    title: 'Bring to Front',
    description: 'Move element to top of stacking order',
    macKeys: ['Shift', ']'],
    winKeys: ['Shift', ']'],
  },
  {
    id: 'arrange-send-backward',
    category: 'arrange',
    title: 'Send Backward',
    description: 'Step element one layer down in stacking order',
    macKeys: ['['],
    winKeys: ['['],
  },
  {
    id: 'arrange-send-to-back',
    category: 'arrange',
    title: 'Send to Back',
    description: 'Move element to bottom of stacking order',
    macKeys: ['Shift', '['],
    winKeys: ['Shift', '['],
  },
  {
    id: 'arrange-aspect-lock',
    category: 'arrange',
    title: 'Lock Aspect Ratio',
    description: 'Hold while resizing to preserve proportions',
    macKeys: ['Shift', 'Resize'],
    winKeys: ['Shift', 'Resize'],
  },
  {
    id: 'arrange-rotate-snap',
    category: 'arrange',
    title: 'Snap Rotation to 15°',
    description: 'Hold while rotating for stepped angles',
    macKeys: ['Shift', 'Rotate'],
    winKeys: ['Shift', 'Rotate'],
  },
];

const CATEGORIES: {
  id: ShortcutCategory;
  label: string;
  icon: typeof MousePointer;
}[] = [
  { id: 'all', label: 'All Shortcuts', icon: HelpCircle },
  { id: 'tools', label: 'Tools', icon: MousePointer },
  { id: 'canvas', label: 'Canvas & View', icon: Move },
  { id: 'edit', label: 'Edit & History', icon: Pencil },
  { id: 'arrange', label: 'Arrange & Layers', icon: Layers },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState<ShortcutCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMac, setIsMac] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    const platform = (
      (navigator as unknown as { userAgentData?: { platform?: string } })
        ?.userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      ''
    ).toLowerCase();
    return (
      platform.includes('mac') ||
      platform.includes('iphone') ||
      platform.includes('ipad')
    );
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const filteredShortcuts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return SHORTCUTS.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) {
        return false;
      }
      if (!query) return true;
      const keysText = [...item.macKeys, ...item.winKeys]
        .join(' ')
        .toLowerCase();
      return (
        item.title.toLowerCase().includes(query) ||
        (item.description && item.description.toLowerCase().includes(query)) ||
        keysText.includes(query)
      );
    });
  }, [activeCategory, searchQuery]);

  return (
    <div
      className="room-dialog-backdrop shortcuts-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="room-gate-card shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="shortcuts-dialog-header">
          <div className="shortcuts-dialog-title-group">
            <div className="shortcuts-icon-wrap" aria-hidden="true">
              <Command size={18} />
            </div>
            <div>
              <h2 id="shortcuts-dialog-title" className="shortcuts-title">
                Keyboard Shortcuts
              </h2>
              <p className="shortcuts-subtitle">
                Master canvas workflows with rapid hotkeys
              </p>
            </div>
          </div>
          <div className="shortcuts-header-actions">
            <button
              type="button"
              className={`shortcuts-platform-toggle ${isMac ? 'is-mac' : 'is-win'}`}
              onClick={() => setIsMac((prev) => !prev)}
              title={`Switch platform keys (currently showing ${isMac ? 'macOS' : 'Windows/Linux'})`}
              aria-label={`Toggle platform keys: currently showing ${isMac ? 'macOS' : 'Windows/Linux'}`}
            >
              <span>{isMac ? '⌘ Mac' : 'Ctrl Win/Linux'}</span>
            </button>
            <button
              type="button"
              className="shortcuts-close-button"
              aria-label="Close shortcuts dialog"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search & Categories Bar */}
        <div className="shortcuts-controls">
          <div className="shortcuts-search-wrap">
            <Search
              size={15}
              className="shortcuts-search-icon"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              className="shortcuts-search-input"
              placeholder="Search hotkeys (e.g. rectangle, zoom, duplicate)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter keyboard shortcuts"
            />
            {searchQuery && (
              <button
                type="button"
                className="shortcuts-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div
            className="shortcuts-categories"
            role="tablist"
            aria-label="Shortcut categories"
          >
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`shortcuts-category-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Shortcuts List / Grid */}
        <div
          className="shortcuts-list-container"
          tabIndex={0}
          role="region"
          aria-label="Shortcut items"
        >
          {filteredShortcuts.length === 0 ? (
            <div className="shortcuts-empty-state">
              <Search
                size={32}
                className="shortcuts-empty-icon"
                aria-hidden="true"
              />
              <p className="shortcuts-empty-title">No shortcuts found</p>
              <p className="shortcuts-empty-desc">
                No hotkeys match &ldquo;{searchQuery}&rdquo;. Try another search
                term or clear the filter.
              </p>
              <button
                type="button"
                className="shortcuts-empty-action"
                onClick={() => {
                  setSearchQuery('');
                  setActiveCategory('all');
                }}
              >
                Show all shortcuts
              </button>
            </div>
          ) : (
            <div className="shortcuts-grid">
              {filteredShortcuts.map((item) => {
                const keys = isMac ? item.macKeys : item.winKeys;
                return (
                  <div key={item.id} className="shortcuts-row">
                    <div className="shortcuts-row-info">
                      <span className="shortcuts-row-title">{item.title}</span>
                      {item.description && (
                        <span className="shortcuts-row-desc">
                          {item.description}
                        </span>
                      )}
                    </div>
                    <div
                      className="shortcuts-row-keys"
                      aria-label={`Key combination: ${keys.join(' + ')}`}
                    >
                      {keys.map((k, idx) => (
                        <span key={idx} className="shortcuts-key-combo">
                          <kbd className="shortcuts-kbd">{k}</kbd>
                          {idx < keys.length - 1 && (
                            <span className="shortcuts-key-separator">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shortcuts-dialog-footer">
          <span className="shortcuts-footer-hint">
            Tip: Press{' '}
            <kbd className="shortcuts-kbd shortcuts-kbd--inline">?</kbd>{' '}
            anywhere on the canvas to open this cheatsheet.
          </span>
          <button
            type="button"
            className="shortcuts-done-btn"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
