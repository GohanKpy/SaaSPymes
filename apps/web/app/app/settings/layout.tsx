'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { PageHeader, useSession } from '../../../lib/ui';

// Ajustes en paginas por tema (fase 2 auditoria de paneles 2026-09-05): antes
// eran 8 tarjetas apiladas con ~46 controles y tres formas distintas de
// guardar. Cada pagina tiene un solo modelo de guardado y su propio aviso.

interface Seccion {
  href: string;
  label: string;
  detalle: string;
  /** Quien la ve. Las integraciones son solo del dueño (la API lo exige). */
  roles?: string[];
}

const SECCIONES: Seccion[] = [
  { href: '/app/settings/empresa', label: 'Empresa y marca', detalle: 'Nombre, RUC, logo, dirección', roles: ['root', 'admin'] },
  { href: '/app/settings/horarios', label: 'Horarios de atención', detalle: 'Días, franjas y feriados', roles: ['root', 'admin'] },
  { href: '/app/settings/bot', label: 'Bot de WhatsApp', detalle: 'Qué puede hacer y cómo atiende', roles: ['root', 'admin'] },
  { href: '/app/settings/whatsapp', label: 'Conexión de WhatsApp', detalle: 'Número, tokens y modo de prueba', roles: ['root'] },
  { href: '/app/settings/calendario', label: 'Google Calendar', detalle: 'Espejo de la agenda', roles: ['root'] },
  { href: '/app/settings/facturacion', label: 'Facturación electrónica', detalle: 'Timbrado y punto de expedición', roles: ['root'] },
  { href: '/app/settings/campos', label: 'Campos del cliente', detalle: 'Datos propios de tu ficha', roles: ['root', 'admin'] },
  { href: '/app/settings/cuenta', label: 'Mi cuenta', detalle: 'Tu contraseña' },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const user = useSession('tenant');
  const pathname = usePathname();
  if (!user) return null;
  const visibles = SECCIONES.filter((s) => !s.roles || s.roles.includes(user.role));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ajustes"
        description="Cómo funciona tu negocio en el sistema: datos, horarios, el bot y las conexiones. Cada sección se guarda por separado."
      />
      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Secciones de ajustes" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {visibles.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm transition-colors lg:shrink ${
                  active ? 'bg-sky-50 font-medium text-sky-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="block">{s.label}</span>
                <span className={`hidden text-[11px] font-normal lg:block ${active ? 'text-sky-700/80' : 'text-slate-400'}`}>
                  {s.detalle}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
