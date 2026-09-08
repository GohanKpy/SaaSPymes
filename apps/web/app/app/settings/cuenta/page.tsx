'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage, roleLabel } from '../../../../lib/labels';
import { useTenantInfo } from '../../../../lib/tenant';
import { Badge, Button, Card, Field, inputClass, useSession } from '../../../../lib/ui';
import { PasswordSection } from '../password';

interface Me {
  id: string;
  email: string;
  fullName: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Mi cuenta (pedido de Johan 2026-09-08): los datos de quien usa el panel
 * (nombre, email, rol, contraseña), el negocio al que pertenece y, para el
 * root, el interruptor de cuenta en desarrollo (DEV). Regla de guardado:
 * formulario con texto → botón Guardar; interruptor → aplica al instante
 * con aviso flotante.
 */
export default function CuentaPage() {
  const user = useSession('tenant');
  const toast = useToast();
  const { tenant } = useTenantInfo();
  const [me, setMe] = useState<Me | null>(null);
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [devMode, setDevMode] = useState<boolean | null>(null);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    void api<Me>('/users/me')
      .then((m) => {
        setMe(m);
        setNombre(m.fullName);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (tenant) setDevMode(tenant.devMode);
  }, [tenant]);

  if (!user) return null;
  const esRoot = user.role === 'root';
  const dev = devMode ?? tenant?.devMode ?? false;

  async function guardarNombre(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const m = await api<Me>('/users/me', { method: 'PATCH', json: { full_name: nombre.trim() } });
      setMe(m);
      toast.success('Nombre guardado');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarDev(valor: boolean) {
    setCambiando(true);
    try {
      await api('/tenant', { method: 'PATCH', json: { dev_mode: valor } });
      setDevMode(valor);
      toast.success(valor ? 'Cambio guardado: la cuenta está en desarrollo' : 'Cambio guardado: la cuenta está en producción');
      // La franja del panel y "Facturar a" leen /tenant al cargar: se refresca la pantalla.
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCambiando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Datos de la cuenta" description="Quién está usando el panel y a qué negocio pertenece.">
        <form className="space-y-3" onSubmit={(e) => void guardarNombre(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <input className={inputClass} value={nombre} maxLength={200} required onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field label="Email (usuario para entrar)">
              <input className={`${inputClass} bg-slate-100`} value={me?.email ?? user.email} readOnly title="Lo cambia un administrador desde Personal → Accesos" />
            </Field>
            <Field label="Rol">
              <p className="py-1.5 text-sm">
                <Badge tone={esRoot ? 'violet' : user.role === 'admin' ? 'sky' : 'slate'}>{roleLabel(me?.role ?? user.role)}</Badge>
              </p>
            </Field>
            <Field label="Último acceso">
              <p className="py-1.5 text-sm text-slate-600">{me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString('es-PY') : '—'}</p>
            </Field>
            <Field label="Negocio">
              <p className="py-1.5 text-sm">
                {tenant ? (
                  <>
                    <span className="font-medium">{tenant.tradeName ?? tenant.legalName}</span>
                    {tenant.tradeName && <span className="text-slate-500"> · {tenant.legalName}</span>}
                  </>
                ) : (
                  '…'
                )}
              </p>
            </Field>
            <Field label="Plan">
              <p className="py-1.5 text-sm text-slate-600">{tenant ? (tenant.currentPlan?.name ?? 'sin plan') : '…'}</p>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link className="text-sm text-sky-700 hover:underline" href="/app/settings/empresa">
              Datos del negocio (razón social, RUC, logo) →
            </Link>
            <Button variant="primary" type="submit" loading={guardando} disabled={!nombre.trim() || nombre.trim() === me?.fullName}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Modo de la cuenta"
        description="En desarrollo, los comprobantes son simulaciones: se emiten sin RUC del receptor ni datos de SIFEN y el KuDE lo dice. En producción, el sistema exige esos datos antes de emitir."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Estado actual:{' '}
            {tenant ? (
              <Badge tone={dev ? 'violet' : 'emerald'}>{dev ? 'DEV · cuenta en desarrollo' : 'Producción'}</Badge>
            ) : (
              '…'
            )}
          </p>
          {esRoot ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={dev} disabled={cambiando || !tenant} onChange={(e) => void cambiarDev(e.target.checked)} />
              Cuenta en desarrollo (DEV)
            </label>
          ) : (
            <span className="text-xs text-slate-500">Solo el dueño (root) puede cambiarlo.</span>
          )}
        </div>
        {dev && (
          <p className="mt-3 text-xs text-amber-700">
            Antes de facturar de verdad, destildá esta opción: a partir de ahí el sistema bloquea cualquier emisión sin receptor o sin
            timbrado.
          </p>
        )}
      </Card>

      <PasswordSection email={me?.email ?? user.email} />
    </div>
  );
}
