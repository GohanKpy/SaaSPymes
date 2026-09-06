'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Button, Card, ErrorNote, Field, PageHeader, inputClass } from '../../../../lib/ui';

// Seguridad (fase 3 auditoria de paneles 2026-09-05): bloqueo de login por
// intentos fallidos. Los valores viven en el panel, no en codigo.

interface Security {
  login_max_attempts: number;
  login_window_min: number;
  login_block_min: number;
}

export default function SeguridadPage() {
  const toast = useToast();
  const [form, setForm] = useState<Security>({ login_max_attempts: 10, login_window_min: 10, login_block_min: 10 });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api<Security>('/platform/settings/security')
      .then((s) => setForm({ login_max_attempts: s.login_max_attempts, login_window_min: s.login_window_min, login_block_min: s.login_block_min }))
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración de seguridad.')));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/platform/settings/security', { method: 'PUT', json: form });
      toast.success('Seguridad guardada: rige en menos de 30 segundos');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Seguridad" description="Bloqueo de login por intentos fallidos. Aplica por cuenta y por dirección IP, en los dos portales." />
      <ErrorNote error={error} />
      <Card tone="amber" title="Bloqueo de login">
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Intentos fallidos permitidos">
              <input className={inputClass} type="number" min={1} max={1000} value={form.login_max_attempts} onChange={(e) => setForm({ ...form, login_max_attempts: Number(e.target.value) })} />
            </Field>
            <Field label="Contados en una ventana de (minutos)">
              <input className={inputClass} type="number" min={1} max={1440} value={form.login_window_min} onChange={(e) => setForm({ ...form, login_window_min: Number(e.target.value) })} />
            </Field>
            <Field label="Duración del bloqueo (minutos)">
              <input className={inputClass} type="number" min={1} max={1440} value={form.login_block_min} onChange={(e) => setForm({ ...form, login_block_min: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Con estos valores: {form.login_max_attempts} intentos fallidos en {form.login_window_min} minutos bloquean la cuenta (y la IP) por {form.login_block_min} minutos. Un
            cliente bloqueado ve "Demasiados intentos" al entrar: se le pide esperar o se le reinicia la contraseña desde su ficha.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar seguridad
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
