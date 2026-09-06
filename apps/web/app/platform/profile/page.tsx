'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Button, Card, Field, PageHeader, inputClass } from '../../../lib/ui';

// Mi perfil (fase 3 auditoria de paneles 2026-09-05): datos propios y
// cambio de contraseña del operador logueado.

export default function PerfilPage() {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', email: '' });
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [guardando, setGuardando] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    void api<{ fullName: string; email: string }>('/platform/me')
      .then((me) => setForm({ full_name: me.fullName, email: me.email }))
      .catch(() => undefined);
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/platform/me', { method: 'PATCH', json: form });
      toast.success('Perfil guardado. Si cambiaste el email, es tu nuevo usuario para entrar.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarContrasena(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.repeat) {
      toast.error('La contraseña nueva y su repetición no coinciden.');
      return;
    }
    setCambiando(true);
    try {
      await api('/platform/me/password', { method: 'POST', json: { current_password: pw.current, new_password: pw.next } });
      setPw({ current: '', next: '', repeat: '' });
      toast.success('Contraseña cambiada. Las sesiones en otros dispositivos se cerraron.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCambiando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Mi perfil" description="Tus datos como operador del portal. El email es tu usuario para entrar." />
      <Card title="Mis datos">
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre completo">
              <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="Email (usuario)">
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Mi contraseña" description="Mínimo 10 caracteres. Al cambiarla se cierran tus sesiones en otros dispositivos.">
        <form className="space-y-3" onSubmit={(e) => void cambiarContrasena(e)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Contraseña actual">
              <input className={inputClass} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
            </Field>
            <Field label="Nueva contraseña">
              <input className={inputClass} type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            </Field>
            <Field label="Repetir la nueva">
              <input className={inputClass} type="password" autoComplete="new-password" minLength={10} value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={cambiando}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
