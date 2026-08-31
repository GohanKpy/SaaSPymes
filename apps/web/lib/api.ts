'use client';

// Cliente del API: access token en memoria (jamas en storage) y refresh
// automatico via cookie httpOnly (doc 05 §3). Al recargar la pagina se
// intenta un refresh silencioso.
// La URL del API se deriva del host desde el que se abrio el panel, asi
// funciona sin reconstruir desde localhost, la LAN y el tunel:
// - laboratorio (localhost / IP privada): mismo host, puerto del API.
// - dominio publico (tunel/proxy): subdominio hermano api.<dominio> SIEMPRE
//   por https, aunque el navegador haya entrado por http (2026-08-31: un
//   socio escribio la direccion sin "https://", la pagina cargo igual y el
//   panel buscaba el API en client.<dominio>:4301 — que no existe afuera —
//   dando "No se pudo conectar con la API").
// NEXT_PUBLIC_API_URL la fija explicitamente si un ambiente rompe la regla.
const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? '4301';

/** Host del laboratorio: localhost o IP de red privada (RFC 1918). */
function esHostLocal(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function derivarApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4301';
  const { hostname, protocol } = window.location;
  if (esHostLocal(hostname)) return `${protocol}//${hostname}:${API_PORT}`;
  // Dominio publico: api.<dominio padre>. Con un host de una sola etiqueta
  // (sin punto) no hay dominio padre: se usa api.<host> como ultimo recurso.
  const partes = hostname.split('.');
  const padre = partes.length > 2 ? partes.slice(1).join('.') : hostname;
  return `https://api.${padre}`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? derivarApiUrl();

// El panel en un dominio publico solo debe viajar por https: entrar por http
// manda la contrasena en claro. Se corrige solo con una redireccion.
if (
  typeof window !== 'undefined' &&
  window.location.protocol === 'http:' &&
  !esHostLocal(window.location.hostname)
) {
  window.location.replace(window.location.href.replace(/^http:/, 'https:'));
}

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

/** Descarga autenticada de una imagen del API como object URL (para <img>). */
export async function apiImageUrl(path: string): Promise<string> {
  const doFetch = () =>
    fetch(`${API_URL}/api/v1${path}`, {
      credentials: 'include',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) res = await doFetch();
  if (!res.ok) throw new ApiError(res.status, {});
  return URL.createObjectURL(await res.blob());
}

export function sseUrl(path: string): string {
  return `${API_URL}/api/v1${path}?access_token=${accessToken ?? ''}`;
}

export { API_URL };
