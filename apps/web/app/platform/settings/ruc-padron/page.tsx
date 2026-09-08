'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  dt,
  inputClass,
  tableCard,
} from '../../../../lib/ui';

// Padron RUC de la DNIT (ADR 0012): copia local del listado publico de
// contribuyentes que alimenta el autocompletado de razon social y DV en los
// paneles de todos los negocios. Corre solo una vez por mes; desde aca se ve
// el estado, se cambia el calendario y se dispara una descarga a mano.

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  triggered_by: 'cron' | 'manual' | 'startup';
  files_ok: number;
  rows_read: number;
  rows_changed: number;
  error: string | null;
}

interface View {
  enabled: boolean;
  page_url: string;
  page_url_default: string;
  day_of_month: number;
  hour: number;
  timezone: string;
  contribuyentes: number;
  last_ok_at: string | null;
  next_run_at: string | null;
  running: boolean;
  runs: Run[];
}

const TRIGGER_LABEL: Record<Run['triggered_by'], string> = {
  cron: 'programada',
  manual: 'manual',
  startup: 'al arrancar',
};
const n = (v: number) => new Intl.NumberFormat('es-PY').format(v);

export default function PadronRucPage() {
  const toast = useToast();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: true, page_url: '', day_of_month: '5', hour: '3' });
  const [guardando, setGuardando] = useState(false);
  const [descargando, setDescargando] = useState(false);

  const load = useCallback(() => {
    api<View>('/platform/settings/ruc-padron')
      .then((v) => {
        setView(v);
        setForm({
          enabled: v.enabled,
          page_url: v.page_url === v.page_url_default ? '' : v.page_url,
          day_of_month: String(v.day_of_month),
          hour: String(v.hour),
        });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar el estado del padrón.')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Mientras hay una descarga en curso se refresca el estado cada 5 s.
  useEffect(() => {
    if (!view?.running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [view?.running, load]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const v = await api<View>('/platform/settings/ruc-padron', {
        method: 'PUT',
        json: {
          enabled: form.enabled,
          page_url: form.page_url.trim() || null,
          day_of_month: Number(form.day_of_month) || 5,
          hour: Number(form.hour) || 0,
        },
      });
      setView(v);
      toast.success('Calendario del padrón guardado');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function descargarAhora() {
    setDescargando(true);
    try {
      await api('/platform/settings/ruc-padron/sync', { method: 'POST', json: {} });
      toast.success('Descarga iniciada: tarda unos minutos, el estado se actualiza solo');
      setTimeout(load, 1500);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDescargando(false);
    }
  }

  const ultima = view?.runs[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Padrón RUC (DNIT)"
        description="Copia local del listado público de contribuyentes de la DNIT. Con esto, al tipear un RUC en clientes o facturas se completan solos la razón social y el dígito verificador, y se ve si el RUC está activo."
        actions={
          <Button
            variant="primary"
            loading={descargando}
            disabled={view?.running}
            onClick={() => void descargarAhora()}
          >
            {view?.running ? 'Descargando…' : 'Descargar ahora'}
          </Button>
        }
      />
      <ErrorNote error={error} />
      {view && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Ahora mismo:</span>
          <Badge tone={view.contribuyentes > 0 ? 'emerald' : 'amber'}>
            {view.contribuyentes > 0
              ? `${n(view.contribuyentes)} contribuyentes cargados`
              : 'padrón vacío: todavía no se descargó'}
          </Badge>
          {view.running && <Badge tone="sky">descarga en curso</Badge>}
          {ultima?.status === 'error' && !view.running && (
            <Badge tone="red">la última descarga falló</Badge>
          )}
          <Badge tone="slate">última carga OK: {dt(view.last_ok_at)}</Badge>
          <Badge tone="slate">próxima: {view.enabled ? dt(view.next_run_at) : 'apagado'}</Badge>
        </div>
      )}
      <Card
        title="Calendario"
        description="La DNIT publica el padrón los primeros días de cada mes. Si el sistema estaba apagado a la hora de la corrida, la hace apenas arranca. Si una descarga falla, el padrón anterior queda intacto y se avisa por correo a los administradores."
      >
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Descarga automática mensual
          </label>
          <div className="grid gap-3 sm:grid-cols-[160px_160px_1fr]">
            <Field label="Día del mes (1-28)">
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.day_of_month}
                onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
              />
            </Field>
            <Field label={`Hora (${view?.timezone ?? 'America/Asuncion'})`}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.hour}
                onChange={(e) => setForm({ ...form, hour: e.target.value })}
              />
            </Field>
            <Field label="Página de la DNIT (vacío = la del sistema)">
              <input
                className={inputClass}
                placeholder={view?.page_url_default ?? ''}
                value={form.page_url}
                onChange={(e) => setForm({ ...form, page_url: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Se descargan los 10 archivos ruc0.zip … ruc9.zip (≈ 40 MB, unos 2 millones de
            contribuyentes). Los enlaces se leen de la página porque cambian en cada publicación; si
            la página no responde se usa la carpeta documental de respaldo de la DNIT.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar calendario
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Últimas descargas">
        {view && view.runs.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no hubo ninguna descarga. Al arrancar la API con el padrón vacío se hace la
            primera sola; también podés dispararla con «Descargar ahora».
          </p>
        ) : (
          <div className={tableCard}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Origen</th>
                  <th>Estado</th>
                  <th>Archivos</th>
                  <th>Leídos</th>
                  <th>Cambiados</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {view?.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{dt(r.started_at)}</td>
                    <td>{dt(r.finished_at)}</td>
                    <td>{TRIGGER_LABEL[r.triggered_by]}</td>
                    <td>
                      <Badge
                        tone={r.status === 'ok' ? 'emerald' : r.status === 'error' ? 'red' : 'sky'}
                      >
                        {r.status === 'ok' ? 'OK' : r.status === 'error' ? 'falló' : 'en curso'}
                      </Badge>
                    </td>
                    <td>{r.files_ok}/10</td>
                    <td>{n(r.rows_read)}</td>
                    <td>{n(r.rows_changed)}</td>
                    <td className="max-w-md truncate text-xs text-slate-500" title={r.error ?? ''}>
                      {r.error ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
