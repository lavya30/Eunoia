import { ApiError } from './rooms-api';
import { resolveSyncHttpUrl } from './sync';

export { ApiError } from './rooms-api';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthResponse = {
  user: AuthUser;
  token: string;
  expiresIn: number;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
  expiresAt: number;
};

const SESSION_STORAGE_KEY = 'eunoia:auth:v1';

function baseUrl(): string {
  const url = resolveSyncHttpUrl();
  if (!url)
    throw new ApiError(
      0,
      'Live services are unavailable until NEXT_PUBLIC_SYNC_SERVER_URL is configured.',
    );
  return url;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown, raw: string): ApiError {
  const body =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  const message =
    body && typeof body.error === 'string' && body.error
      ? body.error
      : raw.trim().slice(0, 200) || `Request failed (${status}).`;
  const code = body && typeof body.code === 'string' ? body.code : null;
  const issues =
    body && Array.isArray(body.issues)
      ? (
          body.issues as Array<{
            path?: unknown;
            message?: unknown;
            code?: unknown;
          }>
        )
          .filter((issue) => issue && typeof issue.message === 'string')
          .map((issue) => ({
            path: typeof issue.path === 'string' ? issue.path : '',
            message: issue.message as string,
            code: typeof issue.code === 'string' ? issue.code : '',
          }))
      : [];
  return new ApiError(status, message, code, issues);
}

async function postAuth<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the sync server. Check your connection.',
    );
  }
  const text = await response.text();
  const payload: unknown = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as T;
}

async function getAuth<T>(path: string, token: string): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the sync server. Check your connection.',
    );
  }
  const text = await response.text();
  const payload: unknown = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as T;
}

export async function registerUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthResponse> {
  return postAuth<AuthResponse>('/api/auth/register', {
    email: input.email,
    password: input.password,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
  });
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return postAuth<AuthResponse>('/api/auth/login', input);
}

export async function fetchMe(token: string): Promise<AuthUser> {
  return getAuth<AuthUser>('/api/auth/me', token);
}

export function saveSession(response: AuthResponse): AuthSession {
  const session: AuthSession = {
    token: response.token,
    user: response.user,
    expiresAt: Date.now() + response.expiresIn * 1000,
  };
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Session persistence is best-effort (private mode, quota).
  }
  return session;
}

export function loadSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      !parsed ||
      typeof parsed.token !== 'string' ||
      !parsed.user ||
      typeof parsed.user.id !== 'string' ||
      typeof parsed.user.email !== 'string'
    )
      return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return {
      token: parsed.token,
      user: {
        id: parsed.user.id,
        email: parsed.user.email,
        name:
          typeof parsed.user.name === 'string' ? parsed.user.name : null,
      },
      expiresAt:
        typeof parsed.expiresAt === 'number'
          ? parsed.expiresAt
          : Number.MAX_SAFE_INTEGER,
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Clearing is best-effort.
  }
}

export function getSessionToken(): string | null {
  return loadSession()?.token ?? null;
}
