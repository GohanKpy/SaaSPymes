'use client';

import { useEffect, useState } from 'react';

import { API_URL } from './api';

// Entrar con Google (2026-09-22, ADR 0014): el boton solo aparece si el
// portal admin habilito el inicio de sesion con Google. El flujo es del
// server: /auth/google/start redirige a Google y el callback vuelve al
// login con ?google=<codigo de un solo uso>.

export function useGoogleLoginEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/api/v1/auth/google/config`)
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

export function irAGoogle(scope: 'tenant' | 'platform'): void {
  const origin = window.location.origin;
  window.location.href = `${API_URL}/api/v1/auth/google/start?scope=${scope}&origin=${encodeURIComponent(origin)}`;
}

export const GOOGLE_ERRORES: Record<string, string> = {
  state: 'El inicio con Google venció o es inválido. Probá de nuevo.',
  vencido: 'El inicio con Google venció. Probá de nuevo.',
  access_denied: 'Cancelaste el acceso con Google.',
  sin_codigo: 'Google no devolvió el código de acceso. Probá de nuevo.',
  config: 'El inicio con Google no está configurado en la plataforma.',
  canje: 'Google rechazó el intercambio. Si sigue pasando, revisá la URI de redirección en Google Cloud.',
  email_no_verificado: 'La cuenta de Google no tiene el email verificado.',
};

export function GoogleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6z" />
        <path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
      </svg>
      Entrar con Google
    </button>
  );
}
