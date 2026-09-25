'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, PageHeader, SecretInput, inputClass } from '../../../../lib/ui';

// Correo saliente del sistema (2026-09-07): por aca salen los resumenes de
// cuenta y las facturas por email de todos los negocios. Sin configurar rige
// el SMTP del entorno (Mailpit en el laboratorio: captura, no entrega).

interface MailView {
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  from_email: string | null;
  from_name: string | null;
  has_password: boolean;
  source: 'panel' | 'env';
}

export default function CorreoPage() {
  const toast = useToast();
  const [view, setView] = useState<MailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ host: '', port: '587', secure: false, user: '', password: '', from_email: '', from_name: '' });
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    api<MailView>('/platform/settings/mail')
      .then((v) => {
        setView(v);
        setForm({ host: v.host ?? '', port: String(v.port ?? 587), secure: v.secure, user: v.user ?? '', password: '', from_email: v.from_email ?? '', from_name: v.from_name ?? '' });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración de correo.')));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const v = await api<MailView>('/platform/settings/mail', {
        method: 'PUT',
        json: {
          host: form.host.trim(),
          port: Number(form.port) || 587,
          secure: form.secure,
          ...(form.user.trim() ? { user: form.user.trim() } : {}),
          ...(form.password ? { password: form.password } : {}),
          from_email: form.from_email.trim(),
          ...(form.from_name.trim() ? { from_name: form.from_name.trim() } : {}),
        },
      });
      setView(v);
      setForm((f) => ({ ...f, password: '' }));
      toast.success('Correo saliente guardado: rige en menos de 30 segundos');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function probar() {
    setProbando(true);
    try {
      const r = await api<{ ok: boolean; to: string }>('/platform/settings/mail/test', { method: 'POST', json: {} });
      toast.success(`Correo de prueba enviado a ${r.to}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProbando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Correo saliente" description="Por acá salen los resúmenes de cuenta y las facturas por email de todos los negocios. Es el SMTP de la plataforma (no el de cada cliente)." />
      <ErrorNote error={error} />
      {view && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Ahora mismo:</span>
          <Badge tone={view.source === 'panel' ? 'emerald' : 'amber'}>{view.source === 'panel' ? 'configurado desde el panel' : 'SMTP del entorno (laboratorio)'}</Badge>
          <Badge tone="slate">
            {view.host}:{view.port}
          </Badge>
          {view.user && <Badge tone={view.has_password ? 'slate' : 'red'}>{view.has_password ? `usuario ${view.user}` : 'falta la contraseña'}</Badge>}
        </div>
      )}
      <Card title="Servidor SMTP" description="La contraseña se guarda cifrada y no se vuelve a mostrar: vacío = mantener la cargada.">
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
            <Field label="Servidor (host) *">
              <input className={inputClass} placeholder="smtp.tuproveedor.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
            </Field>
            <Field label="Puerto">
              <input className={inputClass} inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </Field>
            <Field label="Cifrado">
              <select className={inputClass} value={form.secure ? 'ssl' : 'starttls'} onChange={(e) => setForm({ ...form, secure: e.target.value === 'ssl' })}>
                <option value="starttls">STARTTLS / ninguno (587, 1025)</option>
                <option value="ssl">SSL/TLS (465)</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Usuario (vacío = sin autenticación)">
              <input className={inputClass} autoComplete="off" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
            </Field>
            <Field label={`Contraseña ${view?.has_password ? '(cargada ✓)' : ''}`}>
              <SecretInput name="smtp_password" placeholder={view?.has_password ? 'vacío = mantener' : ''} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Remitente (email) *">
              <input className={inputClass} type="email" placeholder="facturas@tudominio.com" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} required />
            </Field>
            <Field label="Nombre del remitente">
              <input className={inputClass} placeholder="PyMEs SaaS" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            En el laboratorio, sin configurar nada, los correos van a Mailpit (no se entregan): se ven en http://localhost:4307. Con un SMTP real (Gmail con contraseña de aplicación, el de tu hosting, SES) los
            clientes reciben sus resúmenes y facturas.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" loading={probando} onClick={() => void probar()}>
              Enviarme un correo de prueba
            </Button>
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar correo
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
