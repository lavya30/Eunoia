export type LayoutEngine = 'dagre' | 'elk' | 'tala';

export type CompileRequest = {
  source: string;
  engine?: LayoutEngine;
  tier?: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
};

export type CompileResponse = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  engine: LayoutEngine;
  placeholder?: boolean;
  [key: string]: unknown;
};

export async function compileD2(
  request: CompileRequest,
  compilerUrl: string | undefined,
  isDevelopment: boolean,
): Promise<CompileResponse> {
  const engine = request.engine ?? 'dagre';
  if (!compilerUrl) return placeholderLayout(engine);

  try {
    const response = await fetch(compilerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: request.source,
        engine,
        tier: request.tier ?? 'COMMUNITY',
      }),
    });
    if (!response.ok)
      throw new Error(`D2 compiler returned ${response.status}`);
    return (await response.json()) as CompileResponse;
  } catch (error) {
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
