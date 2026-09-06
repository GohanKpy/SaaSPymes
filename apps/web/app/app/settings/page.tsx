'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useSession } from '../../../lib/ui';

/**
 * /app/settings sigue existiendo (es una URL que el dueño ya usa): manda a la
 * primera seccion que le corresponda por rol. El retorno del OAuth de Google
 * (?google=connected|error) va a su propia seccion con el parametro intacto.
 */
export default function SettingsIndex() {
  const router = useRouter();
  const user = useSession('tenant');
  useEffect(() => {
    if (!user) return;
    const q = window.location.search;
    if (new URLSearchParams(q).has('google')) {
      router.replace(`/app/settings/calendario${q}`);
      return;
    }
    router.replace(['root', 'admin'].includes(user.role) ? '/app/settings/empresa' : '/app/settings/cuenta');
  }, [router, user]);
  return <p className="text-sm text-slate-400">Abriendo ajustes…</p>;
}
