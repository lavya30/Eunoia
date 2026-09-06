# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (React 19, App Router, TypeScript Strict Mode), Tailwind CSS v4, Three.js with @react-three/fiber and @react-three/drei for 3D, Monaco Editor for D2 code-to-diagram editing.

## Users

Engineering teams collaborating on architecture diagrams, technical architects creating infrastructure maps, developers visualizing code flows, and open-source contributors producing RFC diagrams.

## Product Purpose

Eunoia is a high-performance, real-time collaborative whiteboard engine designed for engineering teams. It unifies freehand spatial brainstorming with structured, text-driven architecture modeling by natively embedding the D2 declarative diagram language. Users draw freely on an infinite canvas, write D2 code to generate interactive diagrams that behave as native canvas elements, collaborate in real-time with sub-50ms sync latency using Yjs CRDTs, and persist boards server-side with automatic debounced snapshots.

## Positioning

60 FPS infinite-canvas performance at 3,000+ shapes via hardware-accelerated multi-layer rendering with RBush spatial culling. Sub-50ms peer synchronization using decentralized CRDTs (Yjs binary delta encoding). First-class D2 code-to-canvas compilation producing fully interactive native vector elements rather than flat SVGs. True server-side persistence with compressed binary snapshots in PostgreSQL, eliminating local-storage limits and browser crash data loss.

## Operating Context

Users work in browser-based whiteboarding sessions accessed via room links. Engineering teams use Eunoia for architecture design sessions, sprint planning, and system mapping. Technical architects create microservices diagrams, infrastructure maps, and API workflows. D2 diagrams are authored in an embedded Monaco Editor with D2 syntax highlighting. Boards sync via WebSocket rooms with Redis-backed cursor telemetry. Persistence uses PostgreSQL BYTEA storage for compressed Y.Doc snapshots.

## Capabilities and Constraints

- Open-core model: Community Edition (open source, self-hosted) and Pro/Enterprise (managed SaaS)
- Infinite 2D canvas with multi-layer rendering pipeline (background, main scene, interactive)
- Vector tool suite: geometric shapes, connectors with magnetic snap, pressure-sensitive freehand ink (perfect-freehand), transform gizmos
- Real-time multiplayer: Yjs CRDTs for state sync, Redis pub/sub for cursor telemetry, per-user local undo/redo stacks
- D2 code-to-diagram engine: Monaco editor with split-pane layout, debounced compilation pipeline, AST-to-native vector transformation with differential reconciliation
- Server-side persistence: in-memory Y.Doc buffering with debounced PostgreSQL flush, LZ4/Zstandard compression, crash recovery from latest snapshot
- Layout engines: Dagre (Community), ELK + TALA (Pro)
- NFR-1: 60 FPS continuous pan and zoom with 3,000+ vector shapes
- NFR-2: sub-50ms end-to-end peer mutation broadcast
- NFR-3: D2 compile + reconciliation + render under 500ms for 50-node diagrams

## Brand Commitments

Product name: Eunoia. Open-core business model with Community Edition (open source) and Pro/Enterprise tiers ($12/user/month and $30/user/month). Landing page uses a sketch-theme aesthetic (hand-drawn typography, paper texture background, warm accent palette with orange, blue ink, and yellow highlighter highlights).

## Evidence on Hand

- PRD.md: Complete product requirements document covering technology stack, features, business model, and roadmap
- Eunoia_prd.docx: Original PRD document
- Frontend codebase: Next.js 16 with TypeScript, Tailwind CSS v4, Three.js/@react-three/fiber/@react-three/drei installed, Monaco Editor integrated, D2 language syntax highlighting, SplitPaneEditor component with default D2 sample code
- globals.css: Sketch-theme visual direction (dark paper background, Gloria Hallelujah hand-drawn font, Quasand body font, warm accent palette)
- page.tsx: Placeholder (renders "home" text only)

## Product Principles

1. Performance is the product — 60 FPS at scale is non-negotiable
2. Code-first diagramming — D2 text-to-diagram is the primary interface, not a novelty
3. Zero work loss — server-side persistence eliminates local storage risks
4. Engineering-native — built for engineers, by engineers, with engineering workflows first
5. Open core — community adoption through open source, revenue through managed convenience

## Accessibility & Inclusion

No product-specific accessibility requirements documented.
