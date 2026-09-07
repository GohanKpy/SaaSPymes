'use client';

import { useState } from 'react';

import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Button, Card, Field, inputClass } from '../../../lib/ui';

const VACIO = { current_password: '', new_password: '', repeat: '' };

/**
 * Cambio de la propia contraseña (pedido 2026-09-01). Disponible para
 * cualquier rol del panel: es la cuenta del que la usa. Al cambiarla el
 * servidor cierra las demás sesiones abiertas. Mismo flujo que el resto de
 * Ajustes (2026-09-07): botón + aviso flotante de éxito o error.
 */
export function PasswordSection({ email }: { email: string }) {
  const toast = useToast();
  const [form, setForm] = useState(VACIO);
  const [busy, setBusy] = useState(false);

  const corta = form.new_password.length > 0 && form.new_password.length < 8;
  const noCoincide = form.repeat.length > 0 && form.new_password !== form.repeat;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.new_password !== form.repeat) {
      toast.error('La contraseña nueva y su repetición no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await api('/users/me/password', {
        method: 'POST',
        json: { current_password: form.current_password, new_password: form.new_password },
      });
      setForm(VACIO);
      toast.success('Contraseña cambiada. Usá la nueva la próxima vez que entres.');
    } catch (e) {
      toast.error(errorMessage(e, 'No se pudo cambiar la contraseña.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Mi contraseña"
      description={`Cambiá la contraseña con la que entrás al panel (${email}). Al cambiarla se cierran las otras sesiones abiertas con tu cuenta.`}
    >
      <form className="grid grid-cols-1 items-start gap-3 md:grid-cols-3" onSubmit={(e) => void save(e)}>
        <Field label="Contraseña actual">
          <input className={inputClass} type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} required />
        </Field>
        <Field label="Contraseña nueva (mínimo 8 caracteres)">
          <input className={inputClass} type="password" autoComplete="new-password" minLength={8} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} required />
        </Field>
        <Field label="Repetí la contraseña nueva">
          <input className={inputClass} type="password" autoComplete="new-password" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} required />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3 md:col-span-3">
          {corta && <span className="text-xs text-amber-700">La contraseña nueva necesita al menos 8 caracteres.</span>}
          {noCoincide && <span className="text-xs text-amber-700">Las dos contraseñas nuevas no coinciden.</span>}
          <Button variant="primary" type="submit" loading={busy} disabled={corta || noCoincide}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
