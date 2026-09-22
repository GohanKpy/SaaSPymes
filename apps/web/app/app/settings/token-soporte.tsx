'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { copiarTexto } from '../../../lib/clipboard';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Badge, Button, Card, dt, inputClass } from '../../../lib/ui';

// Token de soporte (2026-09-22, ADR 0014): los datos del negocio son
// privados; nadie de la plataforma entra sin este token. El cliente lo
// genera, lo da al soporte y puede revocarlo. El valor se muestra una vez.

interface Estado {
  active: boolean;
  expired: boolean;
  is_initial: boolean;
  expires_at: string | null;
  created_at: string | null;
}

export function TokenSoporteCard() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [horas, setHoras] = useState('24');
  const [nuevo, setNuevo] = useState<{ token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(() => {
    void api<Estado>('/tenant/support-token').then(setEstado).catch(() => setEstado(null));
  }, []);
  useEffect(cargar, [cargar]);

  async function generar() {
    setBusy(true);
    try {
      const r = await api<{ token: string; expires_at: string }>('/tenant/support-token', { method: 'POST', json: { hours: Number(horas) } });
      setNuevo(r);
      cargar();
      toast.success('Token de soporte generado: dáselo a la persona que te atiende');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revocar() {
    const ok = await confirmar({
      title: 'Revocar el token de soporte',
      message: 'Nadie de la plataforma va a poder entrar a tu panel hasta que generes uno nuevo.',
      confirmLabel: 'Revocar',
    });
    if (!ok) return;
    try {
      await api('/tenant/support-token', { method: 'DELETE' });
      setNuevo(null);
      cargar();
      toast.success('Token revocado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card
      title="Acceso para soporte"
      description="Tus datos son privados: nadie de la plataforma puede entrar a tu panel sin un token que vos generes. Cada acceso queda registrado en tu auditoría y te avisamos por correo."
    >
      <div className="space-y-3">
        <p className="text-sm">
          Estado:{' '}
          {estado === null ? (
            '…'
          ) : estado.active && estado.is_initial ? (
            <Badge tone="amber">token inicial (1111), sin vencimiento</Badge>
          ) : estado.active ? (
            <Badge tone="emerald">vigente{estado.expires_at ? ` hasta el ${dt(estado.expires_at)}` : ''}</Badge>
          ) : estado.expired ? (
            <Badge tone="slate">vencido</Badge>
          ) : (
            <Badge tone="slate">sin token: soporte no puede entrar</Badge>
          )}
        </p>
        {estado?.is_initial && (
          <p className="text-xs text-amber-700">
            Todos los negocios arrancan con el token provisorio 1111. Generá uno propio con vencimiento cuando quieras dejar de usarlo.
          </p>
        )}
        {nuevo && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Tu token de soporte (se muestra una sola vez)</p>
            <p className="my-1 font-mono text-2xl font-semibold tracking-widest text-slate-900">{nuevo.token}</p>
            <p className="text-xs text-slate-600">Vence el {dt(nuevo.expires_at)}. Dáselo solo a la persona de soporte que te está atendiendo.</p>
            <Button
              variant="soft"
              className="mt-2"
              onClick={() => {
                void copiarTexto(nuevo.token).then((ok) => (ok ? toast.success('Token copiado') : toast.error('No se pudo copiar')));
              }}
            >
              Copiar
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">Válido por</span>
            <select className={inputClass} value={horas} onChange={(e) => setHoras(e.target.value)}>
              <option value="1">1 hora</option>
              <option value="24">24 horas</option>
              <option value="168">7 días</option>
            </select>
          </label>
          <Button variant="primary" loading={busy} onClick={() => void generar()}>
            Generar token de soporte
          </Button>
          {estado?.active && (
            <Button variant="danger" onClick={() => void revocar()}>
              Revocar
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
