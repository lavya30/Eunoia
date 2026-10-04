export interface DocSnippet {
  language: string;
  code: string;
  title?: string;
  description?: string;
}

export interface DocSection {
  id: string;
  title: string;
  category:
    | 'getting-started'
    | 'd2-syntax'
    | 'engines'
    | 'shortcuts'
    | 'deployment'
    | 'community';
  categoryLabel: string;
  summary: string;
  badge?: string;
}

export interface ShortcutItem {
  key: string;
  action: string;
  category: 'Tools' | 'Canvas & View' | 'Editing' | 'Arrangement' | 'History';
  description: string;
}

export interface EngineInfo {
  id: 'dagre' | 'elk' | 'tala';
  name: string;
  badge: string;
  availability:
    'Community (Free)' | 'Standard (Free / Pro)' | 'Pro / Enterprise';
  tagline: string;
  summary: string;
  characteristics: string[];
  bestFor: string[];
  edgeRouting: string;
  crossingMinimization: 'Basic' | 'High' | 'State-of-the-Art';
  performance:
    'Ultra Fast (<50ms)' | 'Balanced (50-200ms)' | 'Heuristic (~100-300ms)';
}

export const SHORTCUTS_DATA: ShortcutItem[] = [
  // Tools
  {
    key: 'V',
    action: 'Select Tool',
    category: 'Tools',
    description: 'Transform, move, resize, and marquee select canvas elements',
  },
  {
    key: 'H',
    action: 'Hand / Pan Tool',
    category: 'Tools',
    description: 'Pan freely across the infinite 2D canvas without selecting',
  },
  {
    key: 'R',
    action: 'Rectangle',
    category: 'Tools',
    description: 'Draw boxes, system containers, and cards',
  },
  {
    key: 'E',
    action: 'Ellipse',
    category: 'Tools',
    description: 'Draw circles, actor boundaries, and nodes',
  },
  {
    key: 'M',
    action: 'Diamond',
    category: 'Tools',
    description: 'Draw condition logic, routers, and decision points',
  },
  {
    key: 'N',
    action: 'Sticky Note',
    category: 'Tools',
    description: 'Drop colorful brainstorming notes and comments',
  },
  {
    key: 'T',
    action: 'Text Box',
    category: 'Tools',
    description: 'Create auto-wrapping typography and system labels',
  },
  {
    key: 'L',
    action: 'Line / Divider',
    category: 'Tools',
    description: 'Draw straight divider lines between elements',
  },
  {
    key: 'A',
    action: 'Arrow Connector',
    category: 'Tools',
    description: 'Draw smart arrows with magnetic snap to shape ports',
  },
  {
    key: 'D',
    action: 'Draw (Pen)',
    category: 'Tools',
    description: 'Pressure-sensitive freehand sketching with auto-smoothing',
  },
  {
    key: 'X',
    action: 'Eraser',
    category: 'Tools',
    description: 'Erase ink strokes and canvas elements under the cursor',
  },

  // Canvas & View
  {
    key: 'Space + Drag',
    action: 'Quick Pan',
    category: 'Canvas & View',
    description: 'Hold Space to pan smoothly regardless of active tool',
  },
  {
    key: 'Scroll',
    action: 'Zoom Canvas',
    category: 'Canvas & View',
    description: 'Zoom in and out centered on cursor position (35% to 220%)',
  },
  {
    key: 'Ctrl/⌘ + 0',
    action: 'Reset Zoom & Pan',
    category: 'Canvas & View',
    description: 'Reset zoom level and camera back to the default view',
  },
  {
    key: 'Ctrl/⌘ + M',
    action: 'Toggle Minimap',
    category: 'Canvas & View',
    description: 'Show or hide the radar overview map',
  },
  {
    key: "Ctrl/⌘ + '",
    action: 'Cycle Grid',
    category: 'Canvas & View',
    description: 'Toggle grid pattern between dots, lines, and none',
  },
  {
    key: 'Ctrl/⌘ + F',
    action: 'Search Board Nodes',
    category: 'Canvas & View',
    description: 'Open the node search palette to jump to any item',
  },
  {
    key: '?',
    action: 'Keyboard Shortcuts',
    category: 'Canvas & View',
    description: 'Open the shortcuts cheat-sheet dialog',
  },

  // Arrangement
  {
    key: 'Ctrl/⌘ + G',
    action: 'Group Objects',
    category: 'Arrangement',
    description: 'Composite selected shapes into a single movable group',
  },
  {
    key: 'Ctrl/⌘ + Shift + G',
    action: 'Ungroup Objects',
    category: 'Arrangement',
    description: 'Detach grouped objects back into independent elements',
  },
  {
    key: '] / [',
    action: 'Forward / Backward',
    category: 'Arrangement',
    description: 'Raise or lower selection one step in the z-index stack',
  },
  {
    key: 'Shift + ] / Shift + [',
    action: 'Front / Back',
    category: 'Arrangement',
    description: 'Move selection to the very top or bottom layer',
  },
  {
    key: 'Shift + Resize',
    action: 'Lock Aspect Ratio',
    category: 'Arrangement',
    description: 'Hold Shift while resizing to preserve proportions',
  },
  {
    key: 'Shift + Rotate',
    action: 'Snap Rotation',
    category: 'Arrangement',
    description: 'Hold Shift while rotating to snap to 15° increments',
  },
  {
    key: 'Ctrl/⌘ + D',
    action: 'Duplicate',
    category: 'Arrangement',
    description: 'Duplicate selected elements in place',
  },

  // Editing
  {
    key: 'Ctrl/⌘ + A',
    action: 'Select All',
    category: 'Editing',
    description: 'Select every element on the current board',
  },
  {
    key: 'Ctrl/⌘ + C',
    action: 'Copy',
    category: 'Editing',
    description: 'Copy selected elements to the board clipboard',
  },
  {
    key: 'Ctrl/⌘ + X',
    action: 'Cut',
    category: 'Editing',
    description: 'Cut selected elements to the board clipboard',
  },
  {
    key: 'Ctrl/⌘ + V',
    action: 'Paste',
    category: 'Editing',
    description: 'Paste clipboard contents with an offset onto the canvas',
  },
  {
    key: 'Delete / Backspace',
    action: 'Delete Elements',
    category: 'Editing',
    description: 'Remove selected elements from the canvas',
  },
  {
    key: 'Shift + Click',
    action: 'Multi-Select',
    category: 'Editing',
    description: 'Add or remove elements from the current selection',
  },
  {
    key: 'Esc',
    action: 'Deselect / Cancel',
    category: 'Editing',
    description: 'Clear selection or cancel the current operation',
  },

  // History (per-user isolated undo — never reverts peer edits)
  {
    key: 'Ctrl/⌘ + Z',
    action: 'Undo',
    category: 'History',
    description: 'Step backward through your own mutations only',
  },
  {
    key: 'Ctrl/⌘ + Shift + Z / Ctrl/⌘ + Y',
    action: 'Redo',
    category: 'History',
    description: 'Step forward through your own mutations',
  },
];

export const LAYOUT_ENGINES: EngineInfo[] = [
  {
    id: 'dagre',
    name: 'Dagre Layout',
    badge: 'Fast & Classic',
    availability: 'Community (Free)',
    tagline:
      'Standard hierarchical graph layout engine for directed acyclic pipelines.',
    summary:
      'Dagre is the workhorse layout engine for classical flowcharts and simple topologies. It assigns nodes to strict horizontal or vertical rank tiers using Sugiyama-style rank assignment.',
    characteristics: [
      'Strict discrete layer ranking (top-to-bottom or left-to-right)',
      'Deterministic positioning with minimal computation overhead',
      'Straightforward hierarchical flow for pipelines and state machines',
      'Runs locally or in light containers with sub-50ms execution',
    ],
    bestFor: [
      'CI/CD deployment pipelines',
      'Step-by-step state machine transitions',
      'Simple parent-child organizational hierarchies',
      'Lightweight diagrams where compute speed is paramount',
    ],
    edgeRouting:
      'Polyline / Bezier spline routing along discrete rank corridors',
    crossingMinimization: 'Basic',
    performance: 'Ultra Fast (<50ms)',
  },
  {
    id: 'elk',
    name: 'ELK (Eclipse Layout Kernel)',
    badge: 'Orthogonal & Complex',
    availability: 'Standard (Free / Pro)',
    tagline:
      'Advanced constraint-based solver with orthogonal channel edge routing.',
    summary:
      'ELK provides industrial-strength graph routing with dedicated port constraints and orthogonal (right-angled) wiring channels. It eliminates messy diagonal overlapping wires in dense microservice topologies.',
    characteristics: [
      'Orthogonal channel-based routing with clean 90-degree bends',
      'Port placement constraints on specific edges (North, South, East, West)',
      'Superior edge-crossing minimization for highly interconnected topologies',
      'Nested container layout awareness with hierarchical bounding bounds',
    ],
    bestFor: [
      'Dense microservices and distributed event meshes',
      'Database entity-relationship (ER) schemas',
      'Networking topologies with multi-port routers and switches',
      'Systems with hundreds of cross-cutting service calls',
    ],
    edgeRouting: 'Orthogonal channel routing with 90° bends and corner radius',
    crossingMinimization: 'High',
    performance: 'Balanced (50-200ms)',
  },
  {
    id: 'tala',
    name: 'TALA (Terrastruct Architecture)',
    badge: 'Human-Designed Feel',
    availability: 'Pro / Enterprise',
    tagline:
      'Proprietary layout solver handcrafted specifically for software architecture diagrams.',
    summary:
      'Unlike generic graph math libraries that produce rigid algorithmic matrices, TALA solves layout as a spatial aesthetics optimization. It arranges system modules the way experienced senior engineers sketch on physical whiteboards.',
    characteristics: [
      'Organic spatial grouping that clusters logically coupled subsystems',
      'Drastically reduced wire bends and zero unnecessary edge detours',
      'Balanced whitespace distribution that preserves diagram legibility at any scale',
      'Native awareness of cloud architectures, gateways, and storage clusters',
    ],
    bestFor: [
      'Executive architecture overview documents & RFC proposals',
      'Multi-cloud cloud infrastructure topologies (AWS, GCP, Azure)',
      'Production engineering incident rooms and runbooks',
      'Presentations, conference slides, and technical documentation',
    ],
    edgeRouting:
      'Aesthetic straight-line and adaptive low-bend orthogonal routing',
    crossingMinimization: 'State-of-the-Art',
    performance: 'Heuristic (~100-300ms)',
  },
];

export const D2_SNIPPETS = {
  basicNodes: `# 1. Basic Nodes, Shapes and Custom Styles
server: API Gateway {
  shape: rectangle
  style.fill: "#6965DB"
  style.font-color: "#FFFFFF"
  style.stroke: "#4E4AC8"
}

db: Primary Database {
  shape: cylinder
  style.fill: "#E8E7FA"
  style.stroke: "#6965DB"
}

user: Web Client {
  shape: person
}

auth: OAuth 2.0 Provider {
  shape: diamond
  style.fill: "#FEF08A"
}
`,

  connections: `# 2. Directional Edges & Labels
client: Web Browser
gateway: Ingress Gateway
auth: Auth Service
orders: Order Microservice
cache: Redis Cache
db: PostgreSQL DB

# Single directional request
client -> gateway: 1. POST /orders

# Bi-directional verification
gateway <-> auth: 2. Validate JWT token

# Downstream dispatch
gateway -> orders: 3. Process checkout
orders -> cache: 4. Check stock availability
orders -> db: 5. Write order row {
  style.stroke: "#22C55E"
  style.stroke-width: 2
}
`,

  nestedContainers: `# 3. Hierarchical Containers & VPC Clusters
cloud: Production AWS Environment {
  style.fill: "#F8F8FC"
  style.stroke: "#6965DB"
  
  vpc: Private VPC (us-east-1) {
    style.fill: "#FFFFFF"

    public_subnet: Public Subnet {
      alb: Application Load Balancer
      nat: NAT Gateway
    }

    private_subnet: App Subnet {
      api_cluster: ECS Cluster {
        srv1: Order Pod 1
        srv2: Order Pod 2
      }
      queue: SQS Queue
    }

    data_subnet: Data Subnet {
      aurora: Aurora PostgreSQL Multi-AZ {
        shape: cylinder
      }
      redis: ElastiCache Cluster {
        shape: cylinder
      }
    }
  }
}

# Cross-container connections
alb -> api_cluster.srv1: Route traffic
api_cluster.srv1 -> queue: Enqueue billing task
api_cluster.srv1 -> aurora: Read / Write SQL
`,

  sqlSchema: `# 4. Entity Relationship (ER) & Data Models
users: Users Table {
  shape: sql_table
  id: int {constraint: primary_key}
  email: varchar(255) {constraint: unique}
  password_hash: varchar(255)
  created_at: timestamp
}

workspaces: Workspaces Table {
  shape: sql_table
  id: uuid {constraint: primary_key}
  name: varchar(100)
  owner_id: int {constraint: foreign_key}
  plan_tier: varchar(32)
}

boards: Architecture Boards {
  shape: sql_table
  id: uuid {constraint: primary_key}
  workspace_id: uuid {constraint: foreign_key}
  title: varchar(255)
  d2_source: text
  updated_at: timestamp
}

users.id -> workspaces.owner_id: 1-to-Many
workspaces.id -> boards.workspace_id: 1-to-Many
`,

  styleTokens: `# 5. Style Tokens & Color Palettes
# Eunoia supports full CSS HEX codes, stroke widths, and font sizes
box_purple: Primary Focus {
  style: {
    fill: "#6965DB"
    font-color: "#FFFFFF"
    stroke: "#4E4AC8"
    stroke-width: 3
    border-radius: 8
  }
}

box_amber: Pending Review {
  style: {
    fill: "#FEF3C7"
    stroke: "#F59E0B"
    font-color: "#92400E"
  }
}

box_emerald: Operational {
  style: {
    fill: "#DCFCE7"
    stroke: "#16A34A"
    font-color: "#166534"
    stroke-dash: 4
  }
}
`,
};

export const DOCKER_COMPOSE_SNIPPET = `# Eunoia self-hosted stack (mirrors the repo root docker-compose.yml)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: eunoia
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres # change me
    volumes:
      - eunoia-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d eunoia"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    volumes:
      - eunoia-redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  sync-server:
    build:
      context: .
      dockerfile: packages/sync-server/Dockerfile
    environment:
      NODE_ENV: production
      PORT: 3001
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/eunoia?schema=public
      REDIS_URL: redis://redis:6379
      D2_COMPILER_URL: http://d2-compiler:9400/compile
      ROOM_TICKET_SECRET: change_me_to_a_long_random_string
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      d2-compiler:
        condition: service_healthy
    restart: unless-stopped

  d2-compiler:
    build:
      context: services/d2-compiler
    ports:
      - "9400:9400"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:9400/healthz | grep -q ok"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  eunoia-postgres:
  eunoia-redis:
`;

export const ENV_VARS_DOC = [
  {
    name: 'DATABASE_URL',
    required: true,
    defaultVal: '— (required in production)',
    description:
      'PostgreSQL connection URL for rooms, snapshots, users, and teams. Without it the server cannot persist boards.',
  },
  {
    name: 'PORT',
    required: false,
    defaultVal: '3001',
    description: 'HTTP/WebSocket listen port for the sync server.',
  },
  {
    name: 'REDIS_URL',
    required: false,
    defaultVal: '— (degraded without)',
    description:
      'Redis connection string for cross-instance cursor telemetry. The board still syncs without it.',
  },
  {
    name: 'D2_COMPILER_URL',
    required: false,
    defaultVal: '— (dev fallback layout)',
    description:
      'HTTP endpoint of the Go D2 compiler microservice (e.g. http://d2-compiler:9400/compile). Without it the server serves a local fallback layout in development.',
  },
  {
    name: 'ROOM_TICKET_SECRET',
    required: false,
    defaultVal: '— (ephemeral if unset)',
    description:
      'HMAC secret signing room tickets and user session tokens. Set a long random value in production or tickets invalidate on restart.',
  },
  {
    name: 'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET',
    required: false,
    defaultVal: 'None',
    description:
      'Cloudflare R2 credentials for room image uploads. Image endpoints return 503 R2_NOT_CONFIGURED without them.',
  },
  {
    name: 'AI_API_KEY',
    required: false,
    defaultVal: 'None',
    description:
      'OpenAI-compatible API key enabling POST /api/ai/generate (natural-language → D2) with monthly per-tier quotas.',
  },
  {
    name: 'OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URL',
    required: false,
    defaultVal: 'None',
    description:
      'OIDC single sign-on (e.g. Google). SSO endpoints return 503 SSO_NOT_CONFIGURED without them.',
  },
];
