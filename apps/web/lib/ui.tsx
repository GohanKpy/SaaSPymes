'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { getUser, tryRefresh, type SessionUser } from './api';

/** Protege una pagina: restaura sesion via refresh o manda a /login. */
export function useSession(scope?: 'tenant' | 'platform'): SessionUser | null {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(getUser());

  useEffect(() => {
    if (user) return;
    // Cada portal tiene su propio login (ADR 0004).
    const loginPath = scope === 'platform' ? '/platform/login' : '/login';
    void tryRefresh().then((restored) => {
      if (!restored) router.replace(loginPath);
      else if (scope && restored.scope !== scope) router.replace(loginPath);
      else setUser(restored);
    });
  }, [user, router, scope]);

  return user;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none';
export const buttonClass =
  'rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50';
export const buttonGhost =
  'rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100';

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
}

export function money(value: string | number | bigint): string {
  return new Intl.NumberFormat('es-PY').format(Number(value)) + ' Gs';
}

export function dt(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-PY', {
    timeZone: 'America/Asuncion',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
