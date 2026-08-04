'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { API_URL, setSession, type SessionUser } from '../../lib/api';
import { ErrorNote, Field, buttonClass, inputClass } from '../../lib/ui';

interface LoginResponse {
  access_token?: string;
  user?: SessionUser;
  tenant_options?: { id: string; name: string }[];
}

/** Login del portal de clientes: SOLO usuarios de empresas (ADR 0004). */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantOptions, setTenantOptions] = useState<LoginResponse['tenant_options']>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(tenantId?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'tenant', tenant_id: tenantId }),
      });
      const data = (await res.json()) as LoginResponse & { title?: string };
      if (!res.ok) {
        setError(res.status === 401 ? 'Email o contrasena incorrectos.' : (data.title ?? 'Error'));
        return;
      }
      if (data.tenant_options) {
        setTenantOptions(data.tenant_options);
        return;
      }
      if (data.access_token && data.user) {
        setSession(data.access_token, data.user);
        router.replace('/app');
      }
    } catch {
      setError('No se pudo conectar con la API');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">PyMEs SaaS</h1>
        <p className="text-xs text-slate-500">Panel de tu negocio.</p>

        {tenantOptions ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Tu email existe en varias empresas, elegi una:</p>
            {tenantOptions.map((t) => (
              <button
                key={t.id}
                className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => void submit(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Contrasena">
              <input
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <ErrorNote error={error} />
            <button className={`${buttonClass} w-full`} disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
