'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { logout } from '../../lib/api';
import { FeedbackProvider } from '../../lib/feedback';
import { useSession } from '../../lib/ui';

import { AssistantWidget } from './assistant';

// Portal admin (fase 3 auditoria de paneles 2026-09-05): menu lateral
// persistente con estado activo y una pagina por tema. Antes era una sola
// pagina de cinco pantallas de alto con anclas; las anclas viejas siguen
// funcionando (las resuelve /platform).

interface Item {
  href: string;
  label: string;
  /** Otras rutas que tambien marcan este item (la ficha de un cliente marca "Clientes"). */
  match?: string[];
  roles?: string[];
}

const NAV: { title: string; items: Item[] }[] = [
  {
    title: 'Clientes',
    items: [
      { href: '/platform', label: 'Clientes', match: ['/platform/tenants'] },
      { href: '/platform/plans', label: 'Planes' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/platform/settings/bot', label: 'Motor del bot (IA)' },
      { href: '/platform/settings/seguridad', label: 'Seguridad' },
      { href: '/platform/settings/google', label: 'Google Calendar' },
      { href: '/platform/settings/mail', label: 'Correo saliente' },
    ],
  },
  {
    title: 'Seguridad',
    items: [{ href: '/platform/audit', label: 'Auditoría' }],
  },
  {
    title: 'Portal',
    items: [
      { href: '/platform/team', label: 'Usuarios del portal', roles: ['admin'] },
      { href: '/platform/profile', label: 'Mi perfil' },
    ],
  },
];

function isActive(item: Item, pathname: string): boolean {
  if (item.href === '/platform') return pathname === '/platform' || (item.match ?? []).some((m) => pathname.startsWith(m));
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // El login no lleva menu: es la unica pantalla del portal sin sesion.
  const esLogin = pathname === '/platform/login';
  return <FeedbackProvider>{esLogin ? children : <Shell pathname={pathname}>{children}</Shell>}</FeedbackProvider>;
}

function Shell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const user = useSession('platform');
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]);
  if (!user) return null;

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(user.role)),
  })).filter((g) => g.items.length > 0);
  const actual = groups.flatMap((g) => g.items).find((i) => isActive(i, pathname));
  const salir = () => void logout().then(() => location.assign('/platform/login'));

  const marca = (
    <div className="flex h-14 items-center gap-2.5 border-b border-slate-800 px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-sm font-bold text-white">P</span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">PyMEs SaaS</p>
        <p className="text-[11px] text-slate-400">Panel de plataforma</p>
      </div>
    </div>
  );
  const nav = (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active ? 'bg-slate-800 font-medium text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
  const pie = (
    <div className="border-t border-slate-800 p-3">
      <p className="truncate px-1 text-xs text-slate-400">{user.email}</p>
      <div className="mt-2 flex gap-2">
        <a
          className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-center text-sm text-slate-300 transition-colors hover:bg-slate-800"
          href="/guia.html"
          target="_blank"
          rel="noopener"
        >
          Guía
        </a>
        <button
          className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          onClick={salir}
        >
          Salir
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <AssistantWidget />
      {/* Menu lateral (oscuro: identidad distinta al portal de clientes) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-slate-900 text-slate-300 lg:flex">
        {marca}
        {nav}
        {pie}
      </aside>

      {/* Barra superior: en movil abre el menu; en todos los tamaños deja
          lugar (pr-16) a la burbuja fija del asistente arriba a la derecha. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 pr-16 backdrop-blur">
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-label="Abrir menú"
          onClick={() => setMenu(true)}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <p className="text-sm text-slate-500">
          <span className="hidden lg:inline">Panel de plataforma · </span>
          <span className="font-medium text-slate-800">{actual?.label ?? 'Panel de plataforma'}</span>
        </p>
        <button className="ml-auto text-sm text-slate-600 hover:underline lg:hidden" onClick={salir}>
          Salir
        </button>
      </header>

      {menu && (
        <div
          className="fixed inset-0 z-50 bg-black/40 lg:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenu(false);
          }}
        >
          <aside className="flex h-full w-64 flex-col bg-slate-900 text-slate-300 shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              {marca}
              <button type="button" className="rounded-md p-1.5 text-slate-400 hover:text-white" aria-label="Cerrar menú" onClick={() => setMenu(false)}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {nav}
            {pie}
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">{children}</main>
    </div>
  );
}
