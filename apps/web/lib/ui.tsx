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
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/15';

// Botonera estandar: primario (una sola vez por pantalla), suave (accion clave
// dentro de tablas/filas), ghost (neutral) y peligro (destructivo, separado).
export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50';
export const buttonSoft =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100';
export const buttonGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100';
export const buttonDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50';

/** Encabezado de pagina: titulo + descripcion a la izquierda, acciones a la derecha. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const CARD_TONES = {
  default: 'border-slate-200',
  sky: 'border-sky-200',
  violet: 'border-violet-200',
  amber: 'border-amber-200',
} as const;

/** Panel blanco estandar; `tone` colorea el borde para secciones especiales (bot, avisos). */
export function Card({
  title,
  description,
  actions,
  tone = 'default',
  className = '',
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: keyof typeof CARD_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border ${CARD_TONES[tone]} bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-medium text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 max-w-3xl text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Contenedor de tabla a pantalla completa (usar junto con la clase global .tbl). */
export const tableCard = 'overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm';

const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  sky: 'bg-sky-100 text-sky-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  violet: 'bg-violet-100 text-violet-700',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = 'slate',
  className = '',
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Titulo de grupo dentro de un formulario en grilla (ocupa el ancho completo). */
export function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="col-span-full mt-1 border-b border-slate-100 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sky-700">
      {children}
    </h3>
  );
}

/** Fila de "sin datos" para tablas (.tbl): mensaje centrado con guia de que hacer. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-slate-400">
        {children}
      </td>
    </tr>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
}

export function money(value: string | number | bigint): string {
  return new Intl.NumberFormat('es-PY').format(Number(value)) + ' Gs';
}

export function dt(value: string | null | undefined): string {
  if (!value) return '—';
  // Formato de fecha/hora segun la region de la PC del que mira (pedido
  // 2026-08-30): dd/mm en Paraguay, mm/dd en EEUU. La HORA sigue siendo la
  // del negocio (America/Asuncion), solo cambia como se escribe.
  return new Date(value).toLocaleString(undefined, {
    timeZone: 'America/Asuncion',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
