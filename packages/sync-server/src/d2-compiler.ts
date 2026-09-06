export type LayoutEngine = 'dagre' | 'elk' | 'tala';

export type Tier = 'COMMUNITY' | 'PRO' | 'ENTERPRISE';

export type CompileRequest = {
  source: string;
  engine?: LayoutEngine;
  /** Optional room whose stored tier authoritatively gates this compile. */
  roomId?: string;
};

export type CompileOptions = {
  compilerUrl: string | undefined;
  isDevelopment: boolean;
  tier: Tier;
  nodeLimit: number;
};

export type CompileResponse = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  engine: LayoutEngine;
  placeholder?: boolean;
  [key: string]: unknown;
};

export class CompileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CompileRequestError';
  }
}

export class TierUpgradeError extends CompileRequestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 403, 'TIER_UPGRADE_REQUIRED', details);
    this.name = 'TierUpgradeError';
  }
}

export class InvalidEngineError extends CompileRequestError {
  constructor(engine: unknown) {
    super(
      `Unknown layout engine: ${JSON.stringify(engine)}`,
      400,
      'INVALID_ENGINE',
      {
        engine,
      },
    );
    this.name = 'InvalidEngineError';
  }
}

const LAYOUT_ENGINES: LayoutEngine[] = ['dagre', 'elk', 'tala'];

/** ELK and TALA are Pro/Enterprise-only; Dagre is available on every tier. */
const PRO_ENGINES: LayoutEngine[] = ['elk', 'tala'];

export function parseEngine(value: unknown): LayoutEngine {
  if (value === undefined) return 'dagre';
  if (
    typeof value === 'string' &&
    LAYOUT_ENGINES.includes(value as LayoutEngine)
  )
    return value as LayoutEngine;
  throw new InvalidEngineError(value);
}

export function assertEngineAllowed(engine: LayoutEngine, tier: Tier): void {
  if (tier === 'COMMUNITY' && PRO_ENGINES.includes(engine))
    throw new TierUpgradeError(
      `The '${engine}' layout engine requires a Pro or Enterprise tier`,
      { engine, tier },
    );
}

export function assertNodeCountAllowed(
  nodeCount: number,
  tier: Tier,
  nodeLimit: number,
): void {
  if (tier === 'COMMUNITY' && nodeCount > nodeLimit)
    throw new TierUpgradeError(
      `Community diagrams are limited to ${nodeLimit} nodes (got ${nodeCount})`,
      { nodeCount, limit: nodeLimit, tier },
    );
}

export async function compileD2(
  request: CompileRequest,
  options: CompileOptions,
): Promise<CompileResponse> {
  const { compilerUrl, isDevelopment, tier, nodeLimit } = options;
  const engine = parseEngine(request.engine);
  // Gate the engine before touching the compiler so denied tiers never
  // spend (or spoof) a compile, including in placeholder mode.
  assertEngineAllowed(engine, tier);
  if (!compilerUrl) {
    const placeholder = placeholderLayout(engine);
    assertNodeCountAllowed(placeholder.nodes.length, tier, nodeLimit);
    return placeholder;
  }

  try {
    const response = await fetch(compilerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: request.source, engine, tier }),
    });
    if (!response.ok)
      throw new Error(`D2 compiler returned ${response.status}`);
    const compiled = (await response.json()) as CompileResponse;
    assertNodeCountAllowed(compiled.nodes.length, tier, nodeLimit);
    return compiled;
  } catch (error) {
    if (error instanceof TierUpgradeError) throw error;
    if (isDevelopment)
      return {
        ...placeholderLayout(engine),
        error:
          error instanceof Error ? error.message : 'D2 compiler unavailable',
      };
    throw error;
  }
}

function placeholderLayout(engine: LayoutEngine): CompileResponse {
  return { nodes: [], edges: [], engine, placeholder: true };
}
