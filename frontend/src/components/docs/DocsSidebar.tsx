'use client';

import { Search, BookOpen, ExternalLink } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  category: string;
}

const NAV_SECTIONS = [
  {
    category: 'Getting Started',
    items: [
      { id: 'quickstart', label: 'Canvas Fundamentals' },
      { id: 'canvas-tools', label: 'Multi-Layer Vector Tools' },
    ],
  },
  {
    category: 'D2 Declarative Syntax',
    items: [
      { id: 'd2-syntax', label: 'Syntax Overview' },
      { id: 'd2-nodes', label: 'Shapes & Custom Nodes' },
      { id: 'd2-connections', label: 'Connections & Routing' },
      { id: 'd2-containers', label: 'Nested Containers & VPCs' },
      { id: 'd2-er', label: 'Entity Relationship (SQL)' },
      { id: 'd2-styling', label: 'Style Tokens & Colors' },
    ],
  },
  {
    category: 'Layout Engines',
    items: [
      { id: 'engines-overview', label: 'Engine Architecture' },
      { id: 'engines-comparison', label: 'Dagre vs ELK vs TALA' },
    ],
  },
  {
    category: 'Keyboard & Gestures',
    items: [
      { id: 'shortcuts-table', label: 'Keyboard Shortcuts' },
      { id: 'canvas-gestures', label: 'Trackpad & Pan Controls' },
    ],
  },
  {
    category: 'Self-Hosting & DevOps',
    items: [
      { id: 'docker-compose', label: 'Docker Compose Stack' },
      { id: 'env-variables', label: 'Environment Variables' },
      { id: 'production-checklist', label: 'Production Hardening' },
    ],
  },
  {
    category: 'Community',
    items: [
      { id: 'community', label: 'GitHub & Discussions' },
      { id: 'contributing', label: 'Contributing to Eunoia' },
    ],
  },
];

interface DocsSidebarProps {
  activeId: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onItemClick?: () => void;
}

export function DocsSidebar({
  activeId,
  searchQuery,
  setSearchQuery,
  onItemClick,
}: DocsSidebarProps) {
  const filteredSections = NAV_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter(
      (item) =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sec.category.toLowerCase().includes(searchQuery.toLowerCase()),
    ),
  })).filter((sec) => sec.items.length > 0);

  return (
    <aside className="w-full h-full flex flex-col font-sans select-none bg-white">
      {/* Search Input Filter */}
      <div className="p-3 border-b border-gray-100">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="docs-filter-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter documentation..."
            className="w-full bg-gray-50 border border-gray-200 rounded-md pl-8 pr-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:bg-white transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {filteredSections.map((sec) => (
          <div key={sec.category}>
            <div className="px-2 mb-1.5 text-[11px] font-semibold text-gray-900 uppercase tracking-wider">
              {sec.category}
            </div>

            <ul className="space-y-0.5">
              {sec.items.map((item) => {
                const isActive = activeId === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={onItemClick}
                      className={`block px-2.5 py-1 rounded-md text-[13px] transition-colors leading-5 ${
                        isActive
                          ? 'font-medium text-black bg-gray-100'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {filteredSections.length === 0 && (
          <div className="text-center py-6 text-gray-400 text-xs">
            No sections found
          </div>
        )}
      </div>

      {/* Bottom GitHub link */}
      <div className="p-3 border-t border-gray-100">
        <a
          href="https://github.com/lavya30/Eunoia"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-50 text-xs text-gray-600 hover:text-gray-900 transition-colors"
        >
          <span className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-gray-500" />
            GitHub Repository
          </span>
          <ExternalLink className="w-3 h-3 text-gray-400" />
        </a>
      </div>
    </aside>
  );
}
