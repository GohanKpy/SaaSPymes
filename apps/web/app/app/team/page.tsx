'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Equipo se unifico con Empleados en "Personal" (fase 2 auditoria 2026-09-05): la URL vieja sigue andando. */
export default function TeamRedirect() {
  const router = useRouter();
  useEffect(() => router.replace('/app/employees?vista=accesos'), [router]);
  return <p className="text-sm text-slate-400">Abriendo Personal → Accesos al panel…</p>;
}
