'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { logout } from '../../lib/api';
import { FeedbackProvider } from '../../lib/feedback';
import { roleLabel } from '../../lib/labels';
import { useTenantInfo } from '../../lib/tenant';
import { useSession } from '../../lib/ui';

// Iconos inline (trazos estilo lucide) para no sumar dependencias.
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5 M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5',
  chat: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  calendar: 'M8 2v4 M16 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  tasks: 'm9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  customers:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  catalog: 'M20.59 13.41 12 22l-9-9V3h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
  invoices: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  cobros: 'M2 7h20v10H2z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M5 12h.01 M19 12h.01',
  employees:
    'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2 M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  team: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M12.5 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M20 8v6 M23 11h-6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
} as const;

function Icon({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${className} shrink-0`} aria-hidden>
      <path d={d} />
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  roles?: string[];
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operación',
    items: [
      { href: '/app', label: 'Inicio', icon: 'home' },
      { href: '/app/inbox', label: 'Chat', icon: 'chat' },
      { href: '/app/schedule', label: 'Agenda', icon: 'calendar' },
      { href: '/app/tasks', label: 'Tareas', icon: 'tasks' },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { href: '/app/customers', label: 'Clientes', icon: 'customers' },
      { href: '/app/catalog', label: 'Catálogo', icon: 'catalog' },
      { href: '/app/invoices', label: 'Facturación', icon: 'invoices' },
      { href: '/app/cobros', label: 'Cobros', icon: 'cobros' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { href: '/app/employees', label: 'Personal', icon: 'team', roles: ['root', 'admin'] },
      { href: '/app/settings', label: 'Ajustes', icon: 'settings' },
    ],
  },
];

export default function TenantLayout({ children }: { children: ReactNode }) {
  const user = useSession('tenant');
  const { devMode } = useTenantInfo(Boolean(user));
  const pathname = usePathname();
  // Menu movil (fase 4 auditoria de paneles 2026-09-05): panel deslizante con
  // los mismos grupos que el menu lateral; antes eran pastillas con scroll
  // horizontal y Ajustes quedaba fuera de pantalla. Se cierra al navegar.
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]);
  if (!user) return null;

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.roles || item.roles.includes(user.role)),
  })).filter((g) => g.items.length > 0);

  // /app solo exacto; el resto tambien marca sus subpaginas (ej. la ficha de un cliente).
  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));
  const actual = groups.flatMap((g) => g.items).find((i) => isActive(i.href));

  const salir = () => void logout().then(() => location.assign('/login'));

  const nav = (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive(item.href) ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon d={ICONS[item.icon]} />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  const pie = (
    <div className="border-t border-slate-100 p-3">
      <p className="truncate px-1 text-sm font-medium text-slate-700">{user.full_name}</p>
      <p className="px-1 text-[11px] text-slate-400">{roleLabel(user.role)}</p>
      <button className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100" onClick={salir}>
        Cerrar sesión
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Menu lateral (pantallas medianas en adelante) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">P</span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">PyMEs SaaS</p>
            <p className="text-[11px] text-slate-400">Panel del negocio</p>
          </div>
        </div>
        {nav}
        {pie}
      </aside>

      {/* Barra superior (pantallas chicas): abre el menu y muestra donde estas */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3 lg:hidden">
        <button type="button" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Abrir menú" onClick={() => setMenu(true)}>
          <Icon d="M4 7h16M4 12h16M4 17h16" className="h-5 w-5" />
        </button>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          {actual && <Icon d={ICONS[actual.icon]} />}
          {actual?.label ?? 'PyMEs SaaS'}
        </span>
        <span className="ml-auto max-w-[9rem] truncate text-xs text-slate-500">{user.full_name}</span>
      </header>

      {menu && (
        <div
          className="fixed inset-0 z-50 bg-black/40 lg:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenu(false);
          }}
        >
          <aside className="flex h-full w-64 flex-col bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">P</span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-slate-900">PyMEs SaaS</p>
                  <p className="text-[11px] text-slate-400">Panel del negocio</p>
                </div>
              </div>
              <button type="button" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar menú" onClick={() => setMenu(false)}>
                <Icon d="M6 6l12 12M18 6L6 18" className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {pie}
          </aside>
        </div>
      )}

      {devMode && (
        <p className="bg-violet-100 px-3 py-1.5 text-center text-xs text-violet-900 lg:ml-56">
          Cuenta en <strong>modo desarrollo</strong>: los comprobantes son simulaciones sin validez fiscal y se pueden emitir sin datos del
          receptor. Se cambia en Ajustes → Mi cuenta.
        </p>
      )}
      <main className="p-4 md:p-6 lg:ml-56">
        <div className="mx-auto max-w-6xl">
          <FeedbackProvider>{children}</FeedbackProvider>
        </div>
      </main>
    </div>
  );
}
