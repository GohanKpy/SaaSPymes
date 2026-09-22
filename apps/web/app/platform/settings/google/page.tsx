'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, PageHeader, inputClass } from '../../../../lib/ui';

// Google Calendar, app OAuth del sistema (ADR 0007; fase 3 auditoria de
// paneles 2026-09-05). Una sola credencial para toda la plataforma; cada
// cliente conecta despues SU cuenta desde sus Ajustes.

interface GoogleCfg {
  client_id: string | null;
  has_secret: boolean;
  sign_in_enabled: boolean;
}

export default function GooglePage() {
  const toast = useToast();
  const [cfg, setCfg] = useState<GoogleCfg | null>(null);
  const [form, setForm] = useState({ client_id: '', client_secret: '', sign_in_enabled: false });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api<GoogleCfg>('/platform/settings/google')
      .then((g) => {
        setCfg(g);
        setForm((f) => ({ ...f, client_id: g.client_id ?? '', sign_in_enabled: g.sign_in_enabled }));
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración de Google.')));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const updated = await api<GoogleCfg>('/platform/settings/google', {
        method: 'PUT',
        json: {
          client_id: form.client_id.trim(),
          ...(form.client_secret.trim() ? { client_secret: form.client_secret.trim() } : {}),
          sign_in_enabled: form.sign_in_enabled,
        },
      });
      setCfg(updated);
      setForm((f) => ({ ...f, client_secret: '' }));
      toast.success('Google guardado: rige en menos de 30 segundos');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  const listo = Boolean(cfg?.client_id && cfg.has_secret);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Google"
        description="Credencial de la app de Google de la plataforma (identifica al software, como la app de Meta): sirve para el calendario de cada negocio y para iniciar sesión con Google."
      />
      <ErrorNote error={error} />
      {cfg && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Estado:</span>
          <Badge tone={listo ? 'emerald' : 'amber'}>{listo ? 'configurada' : 'incompleta'}</Badge>
          <Badge tone={cfg.client_id ? 'slate' : 'red'}>{cfg.client_id ? 'Client ID cargado' : 'falta Client ID'}</Badge>
          <Badge tone={cfg.has_secret ? 'slate' : 'red'}>{cfg.has_secret ? 'secreto cargado' : 'falta el secreto'}</Badge>
        </div>
      )}
      <Card title="App OAuth de Google" description="El secreto se guarda cifrado y no se vuelve a mostrar: vacío = mantener el cargado.">
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client ID (termina en .apps.googleusercontent.com)">
              <input className={inputClass} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} required />
            </Field>
            <Field label={`Client Secret ${cfg?.has_secret ? '(cargado ✓)' : '(sin cargar)'}`}>
              <input className={inputClass} type="password" autoComplete="off" placeholder={cfg?.has_secret ? 'vacío = mantener' : 'GOCSPX-…'} value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Mientras la app de Google esté en modo prueba, solo las cuentas invitadas como testers en Google Cloud pueden conectarse. Para que cualquier cliente conecte su calendario hay que publicar la app.
          </p>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.sign_in_enabled} onChange={(e) => setForm({ ...form, sign_in_enabled: e.target.checked })} />
            <span>
              <span className="font-medium">Permitir iniciar sesión con Google</span> en el panel de clientes y en este portal
              <span className="block text-xs text-slate-500">
                Google solo prueba la identidad del email: entra quien ya es usuario (no crea cuentas). Hay que registrar en Google Cloud la URI de
                redirección <code className="rounded bg-white px-1">{'<API>'}/api/v1/auth/google/callback</code> además de la del calendario.
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar Google
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
