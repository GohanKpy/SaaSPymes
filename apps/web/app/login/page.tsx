'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { API_URL, setSession, type SessionUser } from '../../lib/api';
import { GOOGLE_ERRORES, GoogleButton, irAGoogle, useGoogleLoginEnabled } from '../../lib/google-login';
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
  const googleEnabled = useGoogleLoginEnabled();
  // Codigo de un solo uso que dejo Google (o el portal admin, sesion de soporte) en la URL.
  const [googleCode, setGoogleCode] = useState<string | null>(null);

  /** Cierra un login por codigo (Google o soporte); con eleccion de empresa pendiente, segunda vuelta. */
  async function completar(path: '/auth/google/complete' | '/auth/support/complete', code: string, tenantId?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'panel' },
        body: JSON.stringify(tenantId ? { code, tenant_id: tenantId } : { code }),
      });
      const data = (await res.json()) as LoginResponse & { title?: string };
      if (!res.ok) {
        setError(data.title ?? 'No se pudo iniciar sesión.');
        setGoogleCode(null);
        return;
      }
      if (data.tenant_options) {
        setGoogleCode(code);
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

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const google = q.get('google');
    const support = q.get('support');
    const googleError = q.get('google_error');
    if (google || support || googleError) window.history.replaceState(null, '', window.location.pathname);
    if (googleError) setError(GOOGLE_ERRORES[googleError] ?? `No se pudo entrar con Google (${googleError}).`);
    if (google) void completar('/auth/google/complete', google);
    if (support) void completar('/auth/support/complete', support);
  }, []);

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
        setError(res.status === 401 ? 'Email o contraseña incorrectos.' : (data.title ?? 'Error'));
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
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-lg font-bold text-white">
            P
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">PyMEs SaaS</h1>
            <p className="text-xs text-slate-500">Panel de tu negocio</p>
          </div>
        </div>

        {tenantOptions ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Tu email existe en varias empresas. Elegí con cuál entrar:</p>
            {tenantOptions.map((t) => (
              <button
                key={t.id}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                disabled={busy}
                onClick={() => (googleCode ? void completar('/auth/google/complete', googleCode, t.id) : void submit(t.id))}
              >
                {t.name}
              </button>
            ))}
            {/* Antes este error quedaba oculto: solo se pintaba en el primer formulario. */}
            <ErrorNote error={error} />
            <button
              type="button"
              className="text-xs text-sky-700 hover:underline"
              onClick={() => {
                setTenantOptions(undefined);
                setGoogleCode(null);
              }}
            >
              ← Volver
            </button>
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
            <Field label="Contraseña">
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
            {googleEnabled && (
              <>
                <p className="text-center text-xs text-slate-400">o</p>
                <GoogleButton disabled={busy} onClick={() => irAGoogle('tenant')} />
                <p className="text-xs text-slate-500">Con Google entrás si tu email ya es usuario de un negocio; no crea cuentas nuevas.</p>
              </>
            )}
            <p className="text-xs text-slate-500">
              ¿Olvidaste tu contraseña? Pedile al dueño o a un administrador de tu negocio que te genere una nueva desde Personal → Accesos al
              panel. Si sos el dueño, pedila al soporte de la plataforma.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
