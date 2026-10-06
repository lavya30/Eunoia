'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DocsSidebar } from './DocsSidebar';
import { CodeBlock } from './CodeBlock';
import { EngineCompare } from './EngineCompare';
import {
  D2_SNIPPETS,
  DOCKER_COMPOSE_SNIPPET,
  SHORTCUTS_DATA,
  ENV_VARS_DOC,
} from './docs-content';
import {
  Menu,
  X,
  Search,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react';

const GithubIcon = ({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const TOC_LINKS = [
  { id: 'quickstart', label: 'Canvas Fundamentals' },
  { id: 'canvas-tools', label: 'Multi-Layer Vector Tools' },
  { id: 'd2-syntax', label: 'D2 Syntax Overview' },
  { id: 'd2-nodes', label: 'Nodes & Custom Shapes' },
  { id: 'd2-connections', label: 'Connections & Routing' },
  { id: 'd2-containers', label: 'Nested Containers & VPCs' },
  { id: 'd2-er', label: 'Entity Relationship (SQL)' },
  { id: 'd2-styling', label: 'Style Tokens' },
  { id: 'engines-overview', label: 'Layout Engines' },
  { id: 'engines-comparison', label: 'Dagre vs ELK vs TALA' },
  { id: 'shortcuts-table', label: 'Keyboard Shortcuts' },
  { id: 'canvas-gestures', label: 'Trackpad & Mouse Gestures' },
  { id: 'docker-compose', label: 'Self-Hosting Docker Stack' },
  { id: 'env-variables', label: 'Environment Variables' },
  { id: 'production-checklist', label: 'Production Hardening' },
  { id: 'community', label: 'Community & Contributing' },
  { id: 'contributing', label: 'Contributing' },
];

export function DocsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('quickstart');

  // Ctrl/⌘+K focuses the docs filter, mirroring the header hint.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        const target = event.target as HTMLElement | null;
        const editable =
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA');
        if (editable) return;
        const input = document.querySelector(
          '#docs-filter-input',
        ) as HTMLInputElement | null;
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track active section on scroll without smooth glides
  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = document.querySelectorAll('section[id], div[id]');
      const scrollPos = window.scrollY + 100;

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const el = sectionElements[i] as HTMLElement;
        if (el.offsetTop <= scrollPos) {
          setActiveSection(el.id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col font-sans antialiased">
      {/* Next.js Docs Header */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-200/80 bg-white/80 backdrop-blur-md px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors"
            aria-label="Toggle navigation menu"
          >
            {sidebarOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>

          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-6 h-6 rounded bg-black flex items-center justify-center font-bold text-white text-xs">
              ▲
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-black">
                Eunoia
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono font-medium border border-gray-200">
                Docs
              </span>
            </div>
          </Link>
        </div>

        {/* Center Search Trigger (Next.js style) */}
        <div className="hidden md:flex items-center">
          <button
            type="button"
            onClick={() => {
              const input = document.querySelector(
                'input[type="text"]',
              ) as HTMLInputElement;
              input?.focus();
            }}
            className="w-72 bg-gray-100/70 hover:bg-gray-100 border border-gray-200/80 rounded-md px-3 py-1.5 flex items-center justify-between text-xs text-gray-500 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <span>Search documentation...</span>
            </span>
            <kbd className="font-mono text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-500">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Right Header Navigation */}
        <div className="flex items-center gap-4 text-xs font-medium">
          <Link
            href="/pricing"
            className="hidden sm:inline-block text-gray-600 hover:text-black transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/status"
            className="hidden sm:inline-block text-gray-600 hover:text-black transition-colors"
          >
            Status
          </Link>
          <a
            href="https://github.com/lavya30/Eunoia"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1 text-gray-600 hover:text-black transition-colors"
          >
            <GithubIcon size={15} />
            <span>GitHub</span>
          </a>
          <Link
            href="/board"
            className="bg-black hover:bg-gray-800 text-white px-3 py-1.5 rounded-md font-medium transition-colors text-xs flex items-center gap-1.5"
          >
            <span>Open Canvas</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </header>

      {/* Main Body Shell (3 Columns on Desktop) */}
      <div className="flex-1 max-w-[1440px] mx-auto w-full flex">
        {/* Left Column: Docs Sidebar (Sticky) */}
        <div className="hidden lg:block w-64 shrink-0 border-r border-gray-200 sticky top-16 h-[calc(100vh-64px)] overflow-hidden bg-white">
          <DocsSidebar
            activeId={activeSection}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        </div>

        {/* Mobile Sidebar Overlay Drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/40"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="relative w-72 max-w-[85vw] h-full bg-white border-r border-gray-200 shadow-2xl flex flex-col z-10">
              <div className="p-4 flex items-center justify-between border-b border-gray-100">
                <span className="font-semibold text-sm text-gray-900">
                  Documentation
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="p-1 rounded text-gray-400 hover:text-gray-900"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DocsSidebar
                  activeId={activeSection}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  onItemClick={() => setSidebarOpen(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Center Column: Documentation Article */}
        <main className="flex-1 min-w-0 px-6 sm:px-12 py-10 max-w-3xl">
          {/* Breadcrumb (Next.js style) */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs text-gray-500 mb-6 font-medium"
          >
            <Link href="/" className="hover:text-black">
              Home
            </Link>
            <ChevronRight className="w-3 h-3 text-gray-400" />
            <span className="text-gray-700">Docs</span>
            <ChevronRight className="w-3 h-3 text-gray-400" />
            <span className="text-black font-semibold">Fundamentals</span>
          </nav>

          {/* Article Header */}
          <div className="mb-10 pb-6 border-b border-gray-100">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-black mb-3">
              Eunoia Documentation
            </h1>
            <p className="text-base sm:text-lg text-gray-600 leading-relaxed font-normal">
              Learn how to design, compile, and visualize software architecture
              with declarative D2 modeling and multi-user spatial whiteboarding.
            </p>
          </div>

          {/* SECTION 1: Canvas Fundamentals */}
          <section id="quickstart" className="scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#quickstart" className="hover:underline">
                Canvas Fundamentals
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-4">
              Eunoia provides an infinite 2D spatial workspace tailored
              specifically for system architects. Canvas interaction is instant
              and unconstrained, supporting concurrent multi-user editing with
              isolated local histories.
            </p>

            {/* Next.js style callout note */}
            <div className="my-6 rounded-lg border border-gray-200 bg-gray-50/70 p-4 text-[14px] leading-6 text-gray-700">
              <span className="font-semibold text-gray-900">Good to know:</span>{' '}
              You can show or hide the split-screen D2 declarative editor at any
              time with the code toggle in the board toolbar — edits recompile
              automatically after a short pause.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
              <div className="p-4 rounded-lg border border-gray-200 bg-white">
                <div className="font-semibold text-sm text-gray-900 mb-1">
                  Infinite Panning
                </div>
                <div className="text-xs text-gray-600 leading-relaxed">
                  Hold{' '}
                  <kbd className="px-1 py-0.5 text-[11px] font-mono bg-gray-100 border border-gray-300 rounded">
                    Space
                  </kbd>{' '}
                  + drag, click with middle mouse, or use two-finger trackpad
                  drag to pan smoothly.
                </div>
              </div>

              <div className="p-4 rounded-lg border border-gray-200 bg-white">
                <div className="font-semibold text-sm text-gray-900 mb-1">
                  Focal Zooming
                </div>
                <div className="text-xs text-gray-600 leading-relaxed">
                  Scroll to zoom continuously from 35% overview up to 220%
                  detail, centered on your cursor. Press{' '}
                  <kbd className="px-1 py-0.5 text-[11px] font-mono bg-gray-100 border border-gray-300 rounded">
                    Ctrl/⌘ + 0
                  </kbd>{' '}
                  to reset the view.
                </div>
              </div>
            </div>

            {/* Vector Tools Subsection */}
            <div id="canvas-tools" className="pt-6 scroll-mt-20">
              <h3 className="text-lg font-semibold tracking-tight text-gray-900 mb-3">
                Multi-Layer Vector Tools
              </h3>
              <p className="text-[15px] leading-7 text-gray-700 mb-4">
                The top toolbar gives you instant access to essential
                architectural drafting tools:
              </p>
              <ul className="list-disc list-inside space-y-2 text-[14px] text-gray-700">
                <li>
                  <strong className="text-gray-900">Geometric Shapes:</strong>{' '}
                  Rectangles, Ellipses, and Decision Diamonds with configurable
                  borders and fill fills.
                </li>
                <li>
                  <strong className="text-gray-900">
                    Magnetic Port Connectors:
                  </strong>{' '}
                  Lines automatically lock to shape ports (North, South, East,
                  West) and update dynamically as components are moved.
                </li>
                <li>
                  <strong className="text-gray-900">
                    Pressure-Sensitive Ink:
                  </strong>{' '}
                  Hand-drawn sketching powered by{' '}
                  <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded text-gray-800">
                    perfect-freehand
                  </code>{' '}
                  with vector smoothing.
                </li>
              </ul>
            </div>
          </section>

          {/* SECTION 2: D2 Declarative Syntax */}
          <section id="d2-syntax" className="pt-12 scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#d2-syntax" className="hover:underline">
                D2 Declarative Syntax
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-4">
              D2 is a modern text-to-diagram language that lets you describe
              architecture in readable declarative code. Compiling D2 transforms
              text into live canvas elements that can be moved, grouped, and
              restyled.
            </p>

            <div id="d2-nodes" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                1. Nodes & Shapes
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Declare nodes with identifiers, labels, and shapes:
              </p>
              <CodeBlock
                code={D2_SNIPPETS.basicNodes}
                language="d2"
                title="nodes.d2"
              />
            </div>

            <div id="d2-connections" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                2. Directional Edges & Connections
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Link systems with directional arrows and edge labels:
              </p>
              <CodeBlock
                code={D2_SNIPPETS.connections}
                language="d2"
                title="connections.d2"
              />
            </div>

            <div id="d2-containers" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                3. Nested Containers & VPCs
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Group microservices and cloud subnets inside parent containers:
              </p>
              <CodeBlock
                code={D2_SNIPPETS.nestedContainers}
                language="d2"
                title="containers.d2"
              />
            </div>

            <div id="d2-er" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                4. Entity Relationship (SQL Tables)
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Define database schemas and foreign-key relationships:
              </p>
              <CodeBlock
                code={D2_SNIPPETS.sqlSchema}
                language="d2"
                title="schema.d2"
              />
            </div>

            <div id="d2-styling" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                5. Style Tokens
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                Customize stroke width, fill colors, and font colors with CSS
                hex values:
              </p>
              <CodeBlock
                code={D2_SNIPPETS.styleTokens}
                language="d2"
                title="styling.d2"
              />
            </div>
          </section>

          {/* SECTION 3: Layout Engines */}
          <section id="engines-overview" className="pt-12 scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#engines-overview" className="hover:underline">
                Layout Engines
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-4">
              When compiling D2, the layout engine solves the mathematical
              placement of every box and arrow. Switch between engines below to
              see how each solver approaches the same topology:
            </p>

            <div id="engines-comparison" className="scroll-mt-20">
              <EngineCompare />
            </div>

            <div className="my-6 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-[14px] leading-6 text-amber-900">
              <span className="font-semibold text-amber-950">
                Why do elements move between engines?
              </span>
              <p className="text-xs text-amber-900/90 mt-1">
                <strong>Dagre</strong> prioritizes strict vertical hierarchy.{' '}
                <strong>ELK</strong> routes wires through orthogonal right
                angles. <strong>TALA</strong> clusters coupled services
                naturally to mimic human whiteboard layouts.
              </p>
            </div>
          </section>

          {/* SECTION 4: Keyboard Shortcuts */}
          <section id="shortcuts-table" className="pt-12 scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#shortcuts-table" className="hover:underline">
                Keyboard Shortcuts
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-4">
              Speed up your workflow using dedicated keyboard hotkeys:
            </p>

            <div className="overflow-x-auto border-t border-b border-gray-200 my-6">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-500 font-mono text-[11px]">
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Key</th>
                    <th className="py-2.5 px-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {SHORTCUTS_DATA.map((sc, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="py-2.5 px-3 font-medium text-gray-900">
                        {sc.action}
                      </td>
                      <td className="py-2.5 px-3 text-gray-500">
                        {sc.category}
                      </td>
                      <td className="py-2.5 px-3">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-300 font-mono text-xs text-gray-800">
                          {sc.key}
                        </kbd>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500">
                        {sc.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div id="canvas-gestures" className="pt-4 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Trackpad Gestures
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded border border-gray-200 bg-gray-50/30">
                  <div className="font-medium text-xs text-gray-900">
                    Space + Drag to Pan
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Hold Space and drag to pan with any tool active.
                  </div>
                </div>
                <div className="p-3 rounded border border-gray-200 bg-gray-50/30">
                  <div className="font-medium text-xs text-gray-900">
                    Scroll to Zoom
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Trackpad scroll or mouse wheel zooms at the cursor.
                  </div>
                </div>
                <div className="p-3 rounded border border-gray-200 bg-gray-50/30">
                  <div className="font-medium text-xs text-gray-900">
                    Middle-Drag to Pan
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Middle mouse button drag pans across the canvas.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 5: Self-Hosting Guide */}
          <section id="docker-compose" className="pt-12 scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#docker-compose" className="hover:underline">
                Self-Hosting Eunoia
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-4">
              Deploy Eunoia on your own private infrastructure using Docker
              Compose. The stack runs the WebSocket sync server, PostgreSQL,
              Redis cursor relay, and the D2 compiler microservice.
            </p>

            <CodeBlock
              code={DOCKER_COMPOSE_SNIPPET}
              language="yaml"
              title="docker-compose.yml"
            />

            <div id="env-variables" className="pt-6 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-3">
                Environment Variables
              </h3>
              <div className="overflow-x-auto border-t border-b border-gray-200 my-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/50 text-gray-500 font-mono text-[11px]">
                      <th className="py-2.5 px-3">Variable</th>
                      <th className="py-2.5 px-3">Required</th>
                      <th className="py-2.5 px-3">Default</th>
                      <th className="py-2.5 px-3">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {ENV_VARS_DOC.map((env, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 font-mono font-medium text-gray-900">
                          {env.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              env.required
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {env.required ? 'required' : 'optional'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500">
                          {env.defaultVal}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">
                          {env.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div id="production-checklist" className="pt-6 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                Production Hardening
              </h3>
              <ul className="list-disc list-inside space-y-1.5 text-xs text-gray-700">
                <li>
                  <strong className="text-gray-900">SSL Termination:</strong>{' '}
                  Use Caddy or Nginx with WebSocket upgrade proxy headers.
                </li>
                <li>
                  <strong className="text-gray-900">Snapshots:</strong> Enable
                  regular automated volume snapshots for{' '}
                  <code className="font-mono text-gray-800">eunoia_pgdata</code>
                  .
                </li>
                <li>
                  <strong className="text-gray-900">Status Monitoring:</strong>{' '}
                  Set up uptime probes targeting{' '}
                  <code className="font-mono text-gray-800">/readyz</code>{' '}
                  (readiness) or{' '}
                  <code className="font-mono text-gray-800">/health</code>{' '}
                  (liveness).
                </li>
              </ul>
            </div>
          </section>

          {/* SECTION 6: Community */}
          <section id="community" className="pt-12 scroll-mt-20">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-4 pb-2 border-b border-gray-100 flex items-center group">
              <a href="#community" className="hover:underline">
                Community & Contributing
              </a>
              <span className="ml-2 text-gray-300 opacity-0 group-hover:opacity-100 text-sm">
                #
              </span>
            </h2>
            <p className="text-[15px] leading-7 text-gray-700 mb-6">
              Eunoia is developed in the open. You can report bugs, submit
              architecture diagram templates, or contribute new layout solvers.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <a
                href="https://github.com/lavya30/Eunoia"
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg border border-gray-200 hover:border-gray-400 bg-white transition-colors block group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-gray-900 group-hover:text-black">
                    GitHub Repository
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-black" />
                </div>
                <p className="text-xs text-gray-500">
                  Star the repository, review the roadmap, or fork the code.
                </p>
              </a>

              <a
                href="https://github.com/lavya30/Eunoia/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg border border-gray-200 hover:border-gray-400 bg-white transition-colors block group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-gray-900 group-hover:text-black">
                    Issue Tracker
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-black" />
                </div>
                <p className="text-xs text-gray-500">
                  Submit bug reports or suggest new layout features.
                </p>
              </a>
            </div>

            <div id="contributing" className="pt-6 scroll-mt-20">
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                Contributing to Eunoia
              </h3>
              <p className="text-xs text-gray-600 mb-2">
                The Community Edition is open source. To run it locally:
              </p>
              <CodeBlock
                code={
                  'bun install\nbun run dev\nbun run lint && bun run typecheck && bun run test'
                }
                language="bash"
                title="terminal"
              />
            </div>
          </section>

          {/* Next.js style Previous / Next Pagination Footer */}
          <div className="mt-16 pt-8 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link
              href="/"
              className="w-full sm:w-auto p-4 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors text-left"
            >
              <span className="text-[11px] text-gray-400 uppercase tracking-wider block">
                Previous
              </span>
              <span className="text-sm font-semibold text-gray-900 flex items-center gap-1 mt-0.5">
                ← Return to Home
              </span>
            </Link>
            <Link
              href="/board"
              className="w-full sm:w-auto p-4 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors text-right"
            >
              <span className="text-[11px] text-gray-400 uppercase tracking-wider block">
                Next
              </span>
              <span className="text-sm font-semibold text-gray-900 flex items-center justify-end gap-1 mt-0.5">
                Launch Canvas Workspace →
              </span>
            </Link>
          </div>
        </main>

        {/* Right Column: "On this page" TOC Sidebar (Next.js Signature) */}
        <div className="hidden xl:block w-56 shrink-0 sticky top-16 h-[calc(100vh-64px)] overflow-y-auto px-4 py-10 text-xs bg-white">
          <div className="font-semibold text-[11px] text-gray-900 uppercase tracking-wider mb-3">
            On this page
          </div>
          <ul className="border-l border-gray-200 space-y-2 pl-3">
            {TOC_LINKS.map((link) => {
              const isActive = activeSection === link.id;
              return (
                <li key={link.id}>
                  <a
                    href={`#${link.id}`}
                    className={`block leading-snug transition-colors ${
                      isActive
                        ? 'text-black font-semibold border-l-2 border-black -ml-[13px] pl-2.5'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {link.label}
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 pt-6 border-t border-gray-100 space-y-2 text-[11px] text-gray-500">
            <a
              href="https://github.com/lavya30/Eunoia"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
            >
              <ExternalLink className="w-3 h-3 text-gray-400" />
              <span>Edit this page on GitHub</span>
            </a>
            <a
              href="https://github.com/lavya30/Eunoia/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
            >
              <ExternalLink className="w-3 h-3 text-gray-400" />
              <span>Share feedback</span>
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 px-6 py-6 bg-white text-xs text-gray-500 flex flex-col sm:flex-row items-center justify-between gap-4 max-w-[1440px] mx-auto w-full">
        <div>© {new Date().getFullYear()} Eunoia Architecture Whiteboard.</div>
        <div className="flex items-center gap-6">
          <Link href="/" className="hover:text-black transition-colors">
            Home
          </Link>
          <Link href="/pricing" className="hover:text-black transition-colors">
            Pricing
          </Link>
          <Link href="/status" className="hover:text-black transition-colors">
            Status
          </Link>
          <Link href="/board" className="hover:text-black transition-colors">
            Board
          </Link>
          <a
            href="https://github.com/lavya30/Eunoia"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
