'use client';

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
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

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/15';

/**
 * Campo para secretos de integraciones (llaves de IA, tokens, client secret).
 * Con type="password" el navegador lo tomaba por un login y lo autocompletaba
 * con la contrasena del panel, que quedaba guardada como llave de OpenAI
 * (2026-09-24). Es texto enmascarado por CSS: ni el navegador ni los gestores
 * de contrasenas lo llenan ni ofrecen guardarlo.
 */
export function SecretInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete' | 'className'>) {
  return (
    <input
      {...props}
      type="text"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore=""
      data-form-type="other"
      className={`${inputClass} font-mono [-webkit-text-security:disc]`}
    />
  );
}

// Botonera estandar: primario (una sola vez por pantalla), suave (accion clave
// dentro de tablas/filas), ghost (neutral) y peligro (destructivo, separado).
export const buttonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50';
export const buttonSoft =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50';
/** Peligro solido: solo dentro de un dialogo de confirmacion (el rojo fuerte se reserva para ese momento). */
export const buttonDangerSolid =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS = {
  primary: buttonClass,
  soft: buttonSoft,
  ghost: buttonGhost,
  danger: buttonDanger,
  'danger-solid': buttonDangerSolid,
} as const;

/**
 * Boton del sistema (fase 0, 2026-09-05). `loading` deshabilita y muestra el
 * giro: un doble clic ya no crea dos turnos, dos facturas ni dos productos.
 */
export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      className={`${BUTTON_VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

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

/** Fila de "sin datos" para tablas (.tbl): mensaje centrado + la accion que sigue. */
export function EmptyRow({
  colSpan,
  action,
  children,
}: {
  colSpan: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <span>{children}</span>
          {action}
        </div>
      </td>
    </tr>
  );
}

/** Estado vacio fuera de una tabla: titulo, explicacion y la accion que sigue. */
export function EmptyState({
  title,
  description,
  action,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center ${className}`}>
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Ventana modal base: cierra con Escape y clic afuera, bloquea el scroll del
 * fondo y enfoca el contenido. Todas las ventanas del sistema pasan por aca.
 */
export function Modal({
  title,
  description,
  onClose,
  size = 'md',
  role = 'dialog',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Enfoca el primer campo si lo hay; si no, el contenedor.
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([aria-label="Cerrar"])');
    (first ?? ref.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl' }[size];
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        tabIndex={-1}
        className={`w-full ${width} rounded-xl bg-white p-5 shadow-2xl outline-none`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pestañas de una pantalla; el estado vive en la URL (?vista=) para que se pueda linkear. */
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? 'border-sky-600 font-medium text-sky-800'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`ml-1.5 rounded-full px-1.5 text-xs ${active ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Lee y escribe un parametro de la URL sin recargar (pestañas, filtros). */
export function useUrlParam(name: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState<string>(() =>
    typeof window === 'undefined' ? fallback : (new URLSearchParams(window.location.search).get(name) ?? fallback),
  );
  useEffect(() => {
    const sync = () => setValue(new URLSearchParams(window.location.search).get(name) ?? fallback);
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [name, fallback]);
  const set = (next: string) => {
    const q = new URLSearchParams(window.location.search);
    if (next === fallback) q.delete(name);
    else q.set(name, next);
    const qs = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    setValue(next);
  };
  return [value, set];
}

/** "Cargar mas" para listas paginadas por cursor: nunca mas un tope invisible de 50. */
export function LoadMore({
  nextCursor,
  loading,
  onLoad,
}: {
  nextCursor: string | null | undefined;
  loading: boolean;
  onLoad: () => void;
}) {
  if (!nextCursor) return null;
  return (
    <div className="flex justify-center border-t border-slate-100 p-3">
      <Button variant="ghost" loading={loading} onClick={onLoad}>
        Cargar más
      </Button>
    </div>
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
