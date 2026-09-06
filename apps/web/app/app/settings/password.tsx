'use client';

import { useState } from 'react';

import { api } from '../../../lib/api';
import { Card, Field, buttonClass, inputClass } from '../../../lib/ui';

const VACIO = { current_password: '', new_password: '', repeat: '' };

/**
 * Cambio de la propia contrasena (pedido 2026-09-01). Disponible para
 * cualquier rol del panel: es la cuenta del que la usa. Al cambiarla el
 * servidor cierra las demas sesiones abiertas.
 */
export function PasswordSection({ email }: { email: string }) {
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const corta = form.new_password.length > 0 && form.new_password.length < 8;
  const noCoincide = form.repeat.length > 0 && form.new_password !== form.repeat;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (form.new_password !== form.repeat) {
      setError('La contraseña nueva y su repetición no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await api('/users/me/password', {
        method: 'POST',
        json: { current_password: form.current_password, new_password: form.new_password },
      });
      setForm(VACIO);
      setOk(true);
      setTimeout(() => setOk(false), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Mi contraseña"
      description={`Cambiá la contraseña con la que entrás al panel (${email}). Al cambiarla se cierran las otras sesiones abiertas con tu cuenta.`}
    >
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {ok && (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          ✓ Contraseña cambiada. Usá la nueva la próxima vez que entres.
        </p>
      )}
      <form className="grid grid-cols-1 items-start gap-3 md:grid-cols-3" onSubmit={(e) => void save(e)}>
        <Field label="Contraseña actual">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={form.current_password}
            onChange={(e) => setForm({ ...form, current_password: e.target.value })}
            required
          />
        </Field>
        <Field label="Contraseña nueva (mínimo 8 caracteres)">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.new_password}
            onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            required
          />
        </Field>
        <Field label="Repetí la contraseña nueva">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={form.repeat}
            onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            required
          />
        </Field>
        <div className="md:col-span-3">
          {corta && <p className="mb-2 text-xs text-amber-700">La contraseña nueva necesita al menos 8 caracteres.</p>}
          {noCoincide && <p className="mb-2 text-xs text-amber-700">Las dos contraseñas nuevas no coinciden.</p>}
          <button className={buttonClass} disabled={busy || corta || noCoincide}>
            {busy ? 'Guardando…' : 'Cambiar mi contraseña'}
          </button>
        </div>
      </form>
    </Card>
  );
}
