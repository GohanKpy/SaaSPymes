'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { getUser, tryRefresh } from '../lib/api';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      const user = getUser() ?? (await tryRefresh());
      // En el portal admin el middleware ya redirigio a /platform; aca solo
      // se resuelve el portal de clientes.
      if (!user || user.scope !== 'tenant') router.replace('/login');
      else router.replace('/app');
    })();
  }, [router]);
  return (
    <main className="flex min-h-screen items-center justify-center text-slate-500">
      Cargando…
    </main>
  );
}
