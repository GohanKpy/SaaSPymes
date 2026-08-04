'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { getUser, tryRefresh } from '../lib/api';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      const user = getUser() ?? (await tryRefresh());
      if (!user) router.replace('/login');
      else router.replace(user.scope === 'platform' ? '/platform' : '/app');
    })();
  }, [router]);
  return (
    <main className="flex min-h-screen items-center justify-center text-slate-500">
      Cargando…
    </main>
  );
}
