'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { logout } from '../../lib/api';
import { buttonGhost, useSession } from '../../lib/ui';

const NAV = [
  { href: '/app', label: 'Inicio' },
  { href: '/app/inbox', label: 'Chat' },
  { href: '/app/schedule', label: 'Agenda' },
  { href: '/app/employees', label: 'Empleados' },
  { href: '/app/customers', label: 'Clientes' },
  { href: '/app/catalog', label: 'Catalogo' },
  { href: '/app/invoices', label: 'Facturas' },
  { href: '/app/team', label: 'Equipo', roles: ['root', 'admin'] },
  { href: '/app/settings', label: 'Ajustes' },
];

export default function TenantLayout({ children }: { children: ReactNode }) {
  const user = useSession('tenant');
  const pathname = usePathname();
  if (!user) return null;
  const nav = NAV.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
          <nav className="flex gap-1 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-1.5 ${pathname === item.href ? 'bg-sky-100 font-medium text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {user.full_name} ({user.role})
            <button className={buttonGhost} onClick={() => void logout().then(() => location.assign('/login'))}>
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
