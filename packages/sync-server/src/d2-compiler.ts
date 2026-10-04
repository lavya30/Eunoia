import { z } from "zod";

export type LayoutEngine = "dagre" | "elk" | "tala";

export type Tier = "COMMUNITY" | "PRO" | "ENTERPRISE";

export type CompileRequest = {
  source: string;
  engine?: LayoutEngine;
  /** Optional room whose stored tier authoritatively gates this compile. */
  roomId?: string;
  /** When true, the compiler also returns a rendered `svg` string. */
  svg?: boolean;
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
  /** True when this layout came from the built-in local fallback parser. */
  fallback?: boolean;
  /** Rendered SVG document, only when requested via `CompileRequest.svg`. */
  svg?: string;
  /** Upstream failure detail, only on development fallback responses. */
  error?: string;
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
    this.name = "CompileRequestError";
  }
}

export class TierUpgradeError extends CompileRequestError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 403, "TIER_UPGRADE_REQUIRED", details);
    this.name = "TierUpgradeError";
  }
}

export class InvalidEngineError extends CompileRequestError {
  constructor(engine: unknown) {
    super(
      `Unknown layout engine: ${JSON.stringify(engine)}`,
      400,
      "INVALID_ENGINE",
      {
        engine,
      },
    );
    this.name = "InvalidEngineError";
  }
}

const LAYOUT_ENGINES: LayoutEngine[] = ["dagre", "elk", "tala"];

/** ELK and TALA require PRO or ENTERPRISE (Community gets dagre + node cap). */
const PRO_ENGINES: LayoutEngine[] = ["elk", "tala"];

const CompileResponseSchema = z
  .object({
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    engine: z.enum(["dagre", "elk", "tala"]),
    placeholder: z.boolean().optional(),
    fallback: z.boolean().optional(),
    svg: z.string().max(5_000_000).optional(),
    error: z.string().max(2000).optional(),
  })
  .passthrough();

const CompilerErrorSchema = z.object({
  error: z.string().min(1).max(2000).optional(),
  code: z.string().max(64).optional(),
});

/**
 * Build a client-facing error from a non-2xx compiler response. The Go
 * compiler answers errors as JSON (`{error, code?}`), and that diagnostic
 * (e.g. `D2 error: 1:21: ...`) is what the user needs — not a generic
 * status code. Retryable upstreams (429/5xx) surface as 502.
 */
function compilerRequestError(
  status: number,
  data: unknown,
  raw: string,
): CompileRequestError {
  const parsed = CompilerErrorSchema.safeParse(data);
  const detail = parsed.success && parsed.data.error ? parsed.data.error : null;
  const snippet = raw.trim().slice(0, 300);
  const message =
    detail ??
    (snippet
      ? `D2 compilation failed (compiler returned ${status}): ${snippet}`
      : `D2 compilation failed (compiler returned ${status})`);
  if (status === 429 || status >= 500)
    return new CompileRequestError(message, 502, "D2_COMPILER_UNAVAILABLE", {
      status,
    });
  const code =
    parsed.success && parsed.data.code ? parsed.data.code : "D2_COMPILE_FAILED";
  return new CompileRequestError(message, 400, code, { status });
}

export function parseEngine(value: unknown): LayoutEngine {
  if (value === undefined) return "dagre";
  if (
    typeof value === "string" &&
    LAYOUT_ENGINES.includes(value as LayoutEngine)
  )
    return value as LayoutEngine;
  throw new InvalidEngineError(value);
}

export function assertEngineAllowed(engine: LayoutEngine, tier: Tier): void {
  if (tier === "COMMUNITY" && PRO_ENGINES.includes(engine))
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
  if (tier === "COMMUNITY" && nodeCount > nodeLimit)
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
  // spend (or spoof) a compile, including in fallback mode.
  assertEngineAllowed(engine, tier);
  if (!compilerUrl) {
    if (!isDevelopment) {
      throw new CompileRequestError(
        "D2 compiler is not configured",
        502,
        "D2_COMPILER_UNAVAILABLE",
      );
    }
    const fallback = fallbackLayout(request.source, engine);
    assertNodeCountAllowed(fallback.nodes.length, tier, nodeLimit);
    return fallback;
  }

  try {
    // A hung compiler must not exhaust the request worker pool: bound the
    // upstream call (the health check already uses the same budget).
    const response = await fetch(compilerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: request.source,
        engine,
        tier,
        svg: request.svg ?? false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Read as text first: upstream proxies/gateways can answer with
    // non-JSON (or empty) bodies, and `response.json()` would throw a bare
    // SyntaxError that hides the real status.
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw.trim() ? (JSON.parse(raw) as unknown) : null;
    } catch {
      throw new Error(
        `D2 compiler returned ${response.status} with a non-JSON response`,
      );
    }
    if (!response.ok) throw compilerRequestError(response.status, data, raw);
    const parsed = CompileResponseSchema.safeParse(data);
    if (!parsed.success)
      throw new Error("D2 compiler returned an invalid response");
    const compiled = parsed.data;
    assertNodeCountAllowed(compiled.nodes.length, tier, nodeLimit);
    return compiled;
  } catch (error) {
    // Client-facing compile failures (tier gating, bad engine, compiler
    // diagnostics) always propagate so the route can return their
    // status/code. Only unexpected failures fall back to a local layout in
    // development; production surfaces the compiler failure.
    if (error instanceof CompileRequestError) throw error;
    if (isDevelopment) {
      const fallback = fallbackLayout(request.source, engine);
      assertNodeCountAllowed(fallback.nodes.length, tier, nodeLimit);
      return {
        ...fallback,
        error:
          error instanceof Error ? error.message : "D2 compiler unavailable",
      };
    }
    if (error instanceof Error) {
      throw new CompileRequestError(
        error.message,
        502,
        "D2_COMPILER_UNAVAILABLE",
      );
    }
    throw error;
  }
}

function placeholderLayout(engine: LayoutEngine): CompileResponse {
  return { nodes: [], edges: [], engine, placeholder: true };
}

/**
 * Best-effort local D2 layout used when no external Go compiler is
 * configured (or unreachable in development). It parses a small but useful
 * subset of D2 — `key: label`, dotted container paths, style/shape
 * attribute lines, and `a -> b [-> c]` edge chains — and places nodes on a
 * deterministic grid so development boards still render instead of silently
 * returning an empty diagram.
 *
 * This is intentionally not a full D2 parser: quoted keys, directives, and
 * comments are handled, but exotic syntax still needs the real compiler.
 */
export function fallbackLayout(
  source: string,
  engine: LayoutEngine,
): CompileResponse {
  const { nodeKeys, nodeLabels, edges } = parseD2Source(source);
  const nodes: Array<Record<string, unknown>> = nodeKeys.map((key, index) => ({
    key,
    label: nodeLabels.get(key) ?? key.split(".").pop() ?? key,
    x: 120 + (index % 5) * 240,
    y: 160 + Math.floor(index / 5) * 160,
    width: 190,
    height: 90,
  }));
  return {
    nodes,
    edges: edges.map((edge) => ({
      key: edge.key,
      source: edge.from,
      target: edge.to,
      ...(edge.label ? { label: edge.label } : {}),
    })),
    engine,
    fallback: true,
  };
}

const FALLBACK_DIRECTIVES = new Set([
  "direction",
  "title",
  "theme",
  "sketch",
  "layout",
  "pad",
  "center",
  "classes",
  "vars",
  "layers",
  "scenarios",
  "steps",
]);

const MAX_FALLBACK_NODES = 500;
const MAX_FALLBACK_EDGES = 1000;

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function unquoteKey(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1).trim();
  return trimmed;
}

function splitEdgeChain(
  text: string,
): { parts: string[]; operators: string[] } | null {
  const operatorPattern = /(<->|<--|-->|->|<-|--)/g;
  if (!operatorPattern.test(text)) return null;
  operatorPattern.lastIndex = 0;
  const parts: string[] = [];
  const operators: string[] = [];
  let last = 0;
  for (;;) {
    const match = operatorPattern.exec(text);
    if (match === null) break;
    parts.push(text.slice(last, match.index));
    operators.push(match[1]);
    last = match.index + match[1].length;
  }
  parts.push(text.slice(last));
  if (parts.some((part) => !part.trim())) return null;
  return { parts, operators };
}

export function parseD2Source(source: string): {
  nodeKeys: string[];
  nodeLabels: Map<string, string>;
  edges: Array<{ key: string; from: string; to: string; label?: string }>;
} {
  const nodeKeys: string[] = [];
  const seen = new Set<string>();
  const nodeLabels = new Map<string, string>();
  const edges: Array<{
    key: string;
    from: string;
    to: string;
    label?: string;
  }> = [];
  const edgeKeys = new Set<string>();

  const ensureNode = (rawKey: string, label?: string): string | null => {
    const key = unquoteKey(rawKey).slice(0, 100).trim();
    if (!key || key.length > 200) return null;
    // Dotted paths create their container prefixes so `a.b: x` still shows `a`.
    const segments = key
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return null;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}.${segment}` : segment;
      if (!seen.has(prefix)) {
        seen.add(prefix);
        nodeKeys.push(prefix);
      }
      if (nodeKeys.length >= MAX_FALLBACK_NODES) break;
    }
    if (label !== undefined && segments.length > 0) {
      const full = segments.join(".");
      if (!nodeLabels.has(full)) nodeLabels.set(full, label.slice(0, 500));
    }
    return segments.join(".");
  };

  const addEdge = (from: string, to: string, label?: string) => {
    if (edges.length >= MAX_FALLBACK_EDGES) return;
    const base = `${from}->${to}`;
    let key = base;
    let suffix = 2;
    while (edgeKeys.has(key)) {
      key = `${base}#${suffix}`;
      suffix += 1;
    }
    edgeKeys.add(key);
    edges.push({ key, from, to, label: label?.slice(0, 200) });
  };

  for (const rawLine of source.split("\n")) {
    const withoutComment = stripInlineComment(rawLine).trim();
    if (!withoutComment) continue;
    // Split off a trailing `: edge label` only for edge lines; node labels
    // are handled per-branch below.
    let line = withoutComment;
    let trailingLabel: string | undefined;

    const chain = splitEdgeChain(line);
    if (chain) {
      // A trailing `: label` belongs to the last edge (`a -> b: hello`).
      const lastPart = chain.parts[chain.parts.length - 1];
      const colon = lastPart.indexOf(":");
      if (colon >= 0) {
        trailingLabel = lastPart.slice(colon + 1).trim() || undefined;
        chain.parts[chain.parts.length - 1] = lastPart.slice(0, colon);
        if (!chain.parts[chain.parts.length - 1].trim()) continue;
      }
      const keys: string[] = [];
      let valid = true;
      for (const part of chain.parts) {
        // Edge endpoints may carry inline labels (`a: A -> b: B`); keep the
        // key before the colon for graph structure.
        const endpoint = part.split(":")[0] ?? "";
        const key = ensureNode(endpoint);
        if (!key) {
          valid = false;
          break;
        }
        keys.push(key);
      }
      if (!valid) continue;
      for (let i = 0; i < keys.length - 1; i++) {
        addEdge(
          keys[i],
          keys[i + 1],
          i === keys.length - 2 ? trailingLabel : undefined,
        );
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon >= 0) {
      const rawKey = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      const topKey = unquoteKey(rawKey.split(".")[0] ?? "").toLowerCase();
      if (FALLBACK_DIRECTIVES.has(topKey)) continue;
      // Attribute lines (`a.style.fill: ...`, `a.shape: ...`) declare `a`.
      const baseKey = rawKey.split(":")[0] ?? rawKey;
      const owner = unquoteKey((baseKey.split(".")[0] ?? "").trim());
      const second = (rawKey.split(".")[1] ?? "").trim().toLowerCase();
      if (second === "shape" || second === "style" || second === "icon") {
        ensureNode(owner);
        continue;
      }
      if (!rawKey.includes(" ") || /^[\w."'\-/\s]+$/.test(rawKey)) {
        ensureNode(rawKey, value || undefined);
        continue;
      }
      void trailingLabel;
      continue;
    }

    const topKey = unquoteKey(line.split(".")[0] ?? "").toLowerCase();
    if (FALLBACK_DIRECTIVES.has(topKey)) continue;
    ensureNode(line);
  }

  if (nodeKeys.length === 0 && source.trim()) {
    const label = source.trim().split("\n")[0]?.slice(0, 500) ?? "diagram";
    ensureNode("diagram", label);
  }

  return { nodeKeys, nodeLabels, edges };
}
