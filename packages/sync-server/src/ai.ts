import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { Tier } from './d2-compiler.js';

/** Monthly generation budgets by tier. Community gets a trial taste. */
export const AI_QUOTA: Record<Tier, number> = {
  COMMUNITY: 10,
  PRO: 500,
  ENTERPRISE: 2000,
};

/** Curated model suggestions for the frontend picker. The provider is any
 * OpenAI-compatible endpoint, so callers may still request other model ids
 * (custom deployments, proxies); this list only drives the UI. */
export const FALLBACK_AI_MODELS = ['openai/gpt-oss-120b'] as const;

export const DEFAULT_AI_MODEL = FALLBACK_AI_MODELS[0];

/** The single server-side model used for every AI feature (no picker). */
export function resolveAiModel(config: Config): string {
  const configured = config.aiModel?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_AI_MODEL;
}

/** Resolve the advertised model list: the fixed server model, always. There
 * is no client model picker; `AI_MODEL` lets the operator change the fixed
 * model, and `AI_MODELS` is accepted but ignored (kept for config compat). */
export function listAiModels(config: Config): {
  models: string[];
  default: string;
} {
  const fixed = resolveAiModel(config);
  return { models: [fixed], default: fixed };
}

export type AiGenerateResult = {
  d2: string;
  model: string;
};

export type AiUsageStore = {
  /** Atomically increments this month's counter, returning the new total. */
  incrementUsage(userId: string, month: string): Promise<number>;
  getUsage(userId: string, month: string): Promise<number>;
};

export function currentMonth(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export class MemoryAiUsageStore implements AiUsageStore {
  private readonly counts = new Map<string, number>();

  async incrementUsage(userId: string, month: string): Promise<number> {
    const key = `${userId}:${month}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async getUsage(userId: string, month: string): Promise<number> {
    return this.counts.get(`${userId}:${month}`) ?? 0;
  }
}

export class PrismaAiUsageStore implements AiUsageStore {
  constructor(private readonly prisma: PrismaClient) {}

  async incrementUsage(userId: string, month: string): Promise<number> {
    const row = await this.prisma.aiUsage.upsert({
      where: { userId_month: { userId, month } },
      update: { count: { increment: 1 } },
      create: { userId, month, count: 1 },
    });
    return row.count;
  }

  async getUsage(userId: string, month: string): Promise<number> {
    const row = await this.prisma.aiUsage.findUnique({
      where: { userId_month: { userId, month } },
    });
    return row?.count ?? 0;
  }
}

const SYSTEM_PROMPT = `You are a D2 diagram-language expert. Convert the user's description into valid D2 code.
Rules:
- Output ONLY D2 code inside a single \`\`\`d2 fenced block, nothing else.
- Use short node keys (lowercase, no spaces) with human labels, e.g. \`api: API Gateway\`.
- Connect nodes with \`->\`, \`--\`, or \`->\` with labels.
- Keep diagrams focused: at most 30 nodes unless asked for more.
- Prefer containers for grouping related nodes.`;

const MAX_PROMPT_CHARS = 4000;
const MAX_LAYOUT_D2_CHARS = 8000;
const MAX_D2_CHARS = 50_000;

/** Default directive when the client sends no layout instruction. */
export const DEFAULT_LAYOUT_INSTRUCTION = 'Improve the layout of this diagram.';

/**
 * Generates D2 source from natural language via any OpenAI-compatible
 * chat-completions endpoint. Keys stay server-side (hosted model). The
 * model is always the fixed server model — clients cannot choose.
 */
export async function generateD2(
  prompt: string,
  config: Config,
): Promise<AiGenerateResult> {
  const apiKey = config.aiApiKey;
  if (!apiKey) throw new Error('AI is not configured');
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error('Prompt must not be empty');
  if (trimmed.length > MAX_PROMPT_CHARS)
    throw new Error('Prompt exceeds the 4000 character limit');
  const content = await chatCompletion(config, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: trimmed },
  ]);
  const d2 = extractD2(content);
  if (d2.length > MAX_D2_CHARS)
    throw new Error('Generated diagram exceeds the size limit');
  return { d2, model: resolveAiModel(config) };
}

const LAYOUT_SYSTEM_PROMPT = `You are a D2 diagram-layout expert. Rewrite the user's D2 to improve its layout.
Rules:
- Output ONLY D2 code inside a single \`\`\`d2 fenced block, nothing else.
- Preserve every existing node key, label, and connection exactly: do not rename, add, or remove content.
- Only improve structure for readability: direction, grouping with containers, and edge arrangement.
- Keep diagrams focused: at most 30 nodes unless the input has more.`;

/**
 * Suggests an improved layout for existing D2 source. Content-preserving by
 * contract (same nodes/edges, better arrangement); the normal compile
 * pipeline remains the real validation.
 */
export async function suggestLayoutD2(
  currentD2: string,
  instruction: string | undefined,
  config: Config,
): Promise<AiGenerateResult> {
  const apiKey = config.aiApiKey;
  if (!apiKey) throw new Error('AI is not configured');
  const source = currentD2.trim();
  if (!source) throw new Error('Current diagram must not be empty');
  if (source.length > MAX_LAYOUT_D2_CHARS)
    throw new Error('Current diagram exceeds the 8000 character limit');
  const directive = instruction?.trim() || DEFAULT_LAYOUT_INSTRUCTION;
  const content = await chatCompletion(config, [
    { role: 'system', content: LAYOUT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Instruction: ${directive}\n\n\`\`\`d2\n${source}\n\`\`\``,
    },
  ]);
  const d2 = extractD2(content);
  if (d2.length > MAX_D2_CHARS)
    throw new Error('Generated diagram exceeds the size limit');
  return { d2, model: resolveAiModel(config) };
}

/** Single OpenAI-compatible chat-completions round-trip. */
async function chatCompletion(
  config: Config,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const apiKey = config.aiApiKey;
  if (!apiKey) throw new Error('AI is not configured');
  const useModel = resolveAiModel(config);
  const baseUrl = (config.aiApiBaseUrl ?? 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: useModel,
      temperature: 0.2,
      max_tokens: 4000,
      messages,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`AI provider answered ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new Error('AI provider returned an empty response');
  return content;
}

/**
 * Pulls the ```d2 fenced block out of a chat response (falling back to
 * the whole trimmed body). The result still flows through the normal
 * compile pipeline, which is the real validation.
 */
export function extractD2(content: string): string {
  const fenced = content.match(/```(?:d2)?\s*\n([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : content).trim();
  if (!candidate) throw new Error('AI provider returned an empty response');
  return candidate;
}
