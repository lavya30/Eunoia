import { ApiError, getSessionToken } from './auth';
import { resolveSyncHttpUrl } from './sync';

export type PlanInfo = {
  key: string;
  name: string;
  pricePerSeat: number;
  currency: string;
};

export type SubscriptionData = {
  id: string;
  userId: string;
  provider: string;
  customerId?: string;
  providerSubId?: string;
  status: string;
  priceKey: string;
  seats: number;
  periodEnd?: string;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionResponse = {
  subscription: SubscriptionData | null;
  userTier: 'COMMUNITY' | 'PRO' | 'ENTERPRISE';
};

export type CheckoutSessionResponse = {
  url: string;
  sessionId: string;
};

export type PortalSessionResponse = {
  url: string;
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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
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
  return new ApiError(status, message, code);
}

export async function fetchPrices(): Promise<{ prices: PlanInfo[] }> {
  const url = `${baseUrl()}/api/billing/prices`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const text = await response.text();
  const payload = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as { prices: PlanInfo[] };
}

export async function createCheckoutSession(
  priceKey = 'pro',
  seats = 1,
  token?: string,
): Promise<CheckoutSessionResponse> {
  const authToken = token ?? getSessionToken();
  if (!authToken) {
    throw new ApiError(
      401,
      'Authentication required to start checkout.',
      'AUTH_REQUIRED',
    );
  }
  const url = `${baseUrl()}/api/billing/checkout`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ priceKey, seats }),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const text = await response.text();
  const payload = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as CheckoutSessionResponse;
}

export async function createPortalSession(
  token?: string,
): Promise<PortalSessionResponse> {
  const authToken = token ?? getSessionToken();
  if (!authToken) {
    throw new ApiError(
      401,
      'Authentication required for billing portal.',
      'AUTH_REQUIRED',
    );
  }
  const url = `${baseUrl()}/api/billing/portal`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const text = await response.text();
  const payload = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as PortalSessionResponse;
}

export async function fetchSubscription(
  token?: string,
): Promise<SubscriptionResponse> {
  const authToken = token ?? getSessionToken();
  if (!authToken) {
    throw new ApiError(401, 'Authentication required.', 'AUTH_REQUIRED');
  }
  const url = `${baseUrl()}/api/billing/subscription`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const text = await response.text();
  const payload = text.trim() ? safeJson(text) : null;
  if (!response.ok) throw toApiError(response.status, payload, text);
  return payload as SubscriptionResponse;
}
