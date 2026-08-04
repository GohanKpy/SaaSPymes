'use client';

// Cliente del API: access token en memoria (jamas en storage) y refresh
// automatico via cookie httpOnly (doc 05 §3). Al recargar la pagina se
// intenta un refresh silencioso.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4301';

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  scope: 'tenant' | 'platform';
  tenant_id?: string;
}

let accessToken: string | null = null;
let currentUser: SessionUser | null = null;

export function getUser(): SessionUser | null {
  return currentUser;
}

export function getToken(): string | null {
  return accessToken;
}

export function setSession(token: string | null, user: SessionUser | null): void {
  accessToken = token;
  currentUser = user;
}

export async function tryRefresh(): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-requested-with': 'panel' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; user: SessionUser };
    setSession(data.access_token, data.user);
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
  setSession(null, null);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { title?: string; detail?: string; errors?: Record<string, string[]> },
  ) {
    super(problem.title ?? `HTTP ${status}`);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });

  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function sseUrl(path: string): string {
  return `${API_URL}/api/v1${path}?access_token=${accessToken ?? ''}`;
}

export { API_URL };
