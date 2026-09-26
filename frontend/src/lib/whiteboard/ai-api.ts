import { ApiError, getSessionToken } from './auth';
import { resolveSyncHttpUrl } from './sync';

export type AiQuota = {
  used: number;
  limit: number;
};

export type GenerateResponse = {
  d2: string;
  model: string;
  quota: AiQuota;
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
 * Ask the server to turn natural language into D2 source. The LLM key
 * never leaves the server; the result flows back into the editor and
 * compiles through the normal pipeline.
 */
export async function generateDiagram(
  prompt: string,
  options: {
    roomId?: string;
    ticket?: string;
    userToken?: string;
    model?: string;
    token?: string;
  } = {},
): Promise<GenerateResponse> {
  const authToken = options.token ?? getSessionToken();
  if (!authToken) {
    throw new ApiError(
      401,
      'Sign in to generate diagrams with AI.',
      'AUTH_REQUIRED',
    );
  }
  const url = `${baseUrl()}/api/ai/generate`;
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
        prompt,
        ...(options.roomId ? { roomId: options.roomId } : {}),
        ...(options.model ? { model: options.model } : {}),
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
