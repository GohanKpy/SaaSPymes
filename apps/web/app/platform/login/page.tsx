'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { API_URL, setSession, type SessionUser } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, inputClass } from '../../../lib/ui';

/** Login del portal de plataforma (ADR 0004): solo administradores del sistema. */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'platform' }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        user?: SessionUser;
        title?: string;
      };
      if (!res.ok || !data.access_token || !data.user) {
        setError(res.status === 401 ? 'Credenciales de administrador incorrectas.' : (data.title ?? 'Error'));
        return;
      }
      setSession(data.access_token, data.user);
      router.replace('/platform');
    } catch {
      setError('No se pudo conectar con la API');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      {/* Tarjeta clara sobre fondo oscuro: los componentes compartidos (Field,
          inputs, ErrorNote) estan diseñados para tema claro. */}
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">Administracion de la plataforma</h1>
        <p className="text-xs text-slate-500">Acceso exclusivo del operador del sistema.</p>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Contrasena">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorNote error={error} />
          <button className={`${buttonClass} w-full`} disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
