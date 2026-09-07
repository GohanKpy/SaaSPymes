'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, inputClass } from '../../../../lib/ui';

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** Facturación electrónica (SIFEN): datos fiscales para numerar y emitir. Muestra lo ya guardado. */
export default function FacturacionPage() {
  const toast = useToast();
  const [sifen, setSifen] = useState<Integration | null | undefined>(undefined);
  const [form, setForm] = useState({ timbrado: '', establishment: '001', expedition_point: '001', vigencia_desde: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Integration[]>('/integrations')
      .then((rows) => {
        const s = rows.find((i) => i.type === 'sifen') ?? null;
        setSifen(s);
        if (s?.configured) {
          setForm({
            timbrado: str(s.public_config.timbrado),
            establishment: str(s.public_config.establishment, '001'),
            expedition_point: str(s.public_config.expedition_point, '001'),
            vigencia_desde: str(s.public_config.vigencia_desde).slice(0, 10),
          });
        }
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración de facturación.')));
  }, []);
  useEffect(() => load(), [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/integrations/sifen', {
        method: 'PUT',
        json: { ...form, vigencia_desde: form.vigencia_desde || undefined },
      });
      toast.success('Datos de facturación electrónica guardados');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  // Cuenta mensual (2026-09-07): cierre automatico.
  const [settings, setSettings] = useState({ monthly_close_day: 1, monthly_auto_invoice: false, recurring_lead_days: 7 });
  const [guardandoCierre, setGuardandoCierre] = useState(false);
  useEffect(() => {
    void api<typeof settings>('/tenant/settings').then(setSettings).catch(() => undefined);
  }, []);
  async function saveCierre(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoCierre(true);
    try {
      const r = await api<typeof settings>('/tenant/settings', {
        method: 'PUT',
        json: { monthly_close_day: settings.monthly_close_day, monthly_auto_invoice: settings.monthly_auto_invoice },
      });
      setSettings(r);
      toast.success('Cierre mensual guardado');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoCierre(false);
    }
  }

  if (sifen === undefined) return <ErrorNote error={error} />;

  return (
    <>
      <ErrorNote error={error} />
      <Card
        title="Cuenta mensual: cierre automático"
        description="Para los clientes con Facturación: cuenta mensual (se elige en su ficha). En la fecha de cierre el sistema arma el resumen del mes anterior por cliente, se lo envía por su canal (WhatsApp o email), te avisa con una tarea y un correo, y si lo activás, emite la factura y la envía."
      >
        <form className="space-y-3" onSubmit={(e) => void saveCierre(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Día del mes en que se cierra la cuenta (1 a 28)">
              <input
                className={inputClass}
                type="number"
                min={1}
                max={28}
                value={settings.monthly_close_day}
                onChange={(e) => setSettings({ ...settings, monthly_close_day: Number(e.target.value) })}
              />
              <span className="mt-0.5 block text-xs text-slate-400">Se cierra lo consumido hasta el último día del mes anterior; lo del mes en curso queda para el próximo cierre.</span>
            </Field>
            <label className="flex items-start gap-2 pt-6 text-sm">
              <input type="checkbox" className="mt-0.5" checked={settings.monthly_auto_invoice} onChange={(e) => setSettings({ ...settings, monthly_auto_invoice: e.target.checked })} />
              <span>
                <b>Facturar automáticamente al cerrar</b>
                <span className="block text-xs text-slate-500">
                  Emite una factura por cliente con todos sus consumos (a nombre de su RUC predeterminado) y se la envía. Apagado: solo se envía el resumen y facturás vos desde Facturación → Cuentas del mes.
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardandoCierre}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Facturación electrónica (SIFEN)
            {sifen?.configured ? <Badge tone="emerald">timbrado {str(sifen.public_config.timbrado)}</Badge> : <Badge tone="amber">falta configurar</Badge>}
          </span>
        }
        description="SIFEN es el sistema de facturación electrónica de la SET. Con estos datos el sistema numera tus facturas y genera el comprobante (KuDE, el PDF que recibe tu cliente). Sin ellos no se puede emitir."
      >
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void save(e)}>
          <Field label="Timbrado (8 dígitos) *">
            <input className={inputClass} inputMode="numeric" value={form.timbrado} onChange={(e) => setForm({ ...form, timbrado: e.target.value })} required />
          </Field>
          <Field label="Inicio de vigencia del timbrado (se imprime en el comprobante)">
            <input className={inputClass} type="date" value={form.vigencia_desde} onChange={(e) => setForm({ ...form, vigencia_desde: e.target.value })} />
          </Field>
          <Field label="Establecimiento (3 dígitos) *">
            <input className={inputClass} inputMode="numeric" value={form.establishment} onChange={(e) => setForm({ ...form, establishment: e.target.value })} required />
          </Field>
          <Field label="Punto de expedición (3 dígitos) *">
            <input className={inputClass} inputMode="numeric" value={form.expedition_point} onChange={(e) => setForm({ ...form, expedition_point: e.target.value })} required />
          </Field>
          <p className="text-xs text-slate-400 md:col-span-2">
            Establecimiento y punto de expedición salen de tu timbrado: si tenés un solo local y una sola caja, casi siempre son 001 y 001. El número de factura se arma como
            establecimiento-punto-secuencia (ej. 001-001-0000012).
          </p>
          <div className="flex justify-end md:col-span-2">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
