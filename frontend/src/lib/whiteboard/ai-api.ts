import { ApiError, getSessionToken } from './auth';
import { resolveSyncHttpUrl } from './sync';

export type AiQuota = {
  used: number;
  limit: number;
};

export type JevVerdict = {
  matchesIntent: number;
  likelyValid: number;
  confidence: number;
  warnings: string[];
};

export type GenerateResponse = {
  d2: string;
  model: string;
  quota: AiQuota;
  jev?: JevVerdict;
};

function baseUrl(): string {
  const url = resolveSyncHttpUrl();
  if (!url)
    throw new ApiError(
      0,
      'Live services are unavailable until NEXT_PUBLIC_SYNC_SERVER_URL is configured.',
    );
  return url;
}

/**
 * Shared POST helper for the hosted AI endpoints. The LLM key never leaves
 * the server; results flow back into the editor and compile through the
 * normal pipeline.
 */
async function postAi(
  path: '/api/ai/generate' | '/api/ai/suggest-layout',
  body: Record<string, unknown>,
  options: {
    roomId?: string;
    ticket?: string;
    userToken?: string;
    token?: string;
  } = {},
): Promise<GenerateResponse> {
  const authToken = options.token ?? getSessionToken();
  if (!authToken) {
    throw new ApiError(401, 'Sign in to use AI features.', 'AUTH_REQUIRED');
  }
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.ticket
          ? { authorization: `Bearer ${options.ticket}` }
          : { authorization: `Bearer ${authToken}` }),
        'x-user-token': authToken,
      },
      body: JSON.stringify({
        ...body,
        ...(options.roomId ? { roomId: options.roomId } : {}),
      }),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;
    throw new ApiError(
      response.status,
      body && typeof body.error === 'string' && body.error
        ? body.error
        : text.trim().slice(0, 200) || `Request failed (${response.status}).`,
      body && typeof body.code === 'string' ? body.code : null,
    );
  }
  return payload as GenerateResponse;
}

/** Ask the server to turn natural language into D2 source. */
export async function generateDiagram(
  prompt: string,
  options: {
    roomId?: string;
    ticket?: string;
    userToken?: string;
    token?: string;
  } = {},
): Promise<GenerateResponse> {
  return postAi('/api/ai/generate', { prompt }, options);
}

/**
 * Ask the server to suggest a better layout for existing D2 source.
 * Content-preserving by contract: same nodes/edges, improved arrangement.
 */
export async function suggestLayout(
  d2: string,
  options: {
    roomId?: string;
    ticket?: string;
    userToken?: string;
    token?: string;
  } = {},
): Promise<GenerateResponse> {
  return postAi('/api/ai/suggest-layout', { d2 }, options);
}
