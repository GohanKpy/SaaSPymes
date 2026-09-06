'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** /platform/settings manda al primer tema del sistema (fase 3 auditoria 2026-09-05). */
export default function PlatformSettingsIndex() {
  const router = useRouter();
  useEffect(() => router.replace('/platform/settings/bot'), [router]);
  return <p className="text-sm text-slate-400">Abriendo ajustes del sistema…</p>;
}
