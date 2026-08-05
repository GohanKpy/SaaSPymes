'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { ErrorNote, Field, buttonClass, inputClass } from '../../../lib/ui';

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}
interface BotSettings {
  enabled: boolean;
  instructionsText: string | null;
  accessCatalog: boolean;
  accessHistory: boolean;
  accessCustomerData: boolean;
  accessCalendar: boolean;
  allowBooking: boolean;
  autoConfirmBookings: boolean;
  engine_available: boolean;
  usage: {
    period: string;
    input_tokens: number;
    output_tokens: number;
    turns: number;
    budget: number;
    exhausted: boolean;
  };
}

const PERMISOS: { key: keyof BotSettings; label: string }[] = [
  { key: 'accessCatalog', label: 'Puede consultar el catalogo y precios' },
  { key: 'accessCalendar', label: 'Puede consultar disponibilidad de agenda' },
  { key: 'allowBooking', label: 'Puede agendar turnos' },
  { key: 'autoConfirmBookings', label: 'Turnos del bot se confirman solos (sin confirmacion manual)' },
  { key: 'accessHistory', label: 'Puede ver historial del cliente de la conversacion' },
  { key: 'accessCustomerData', label: 'Puede ver datos de contacto del cliente' },
];

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [bot, setBot] = useState<BotSettings | null>(null);
  const [wa, setWa] = useState({ phone_number_id: '', access_token: '', verify_token: 'dev-verify-token' });
  const [sifen, setSifen] = useState({ timbrado: '', establishment: '001', expedition_point: '001' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Integration[]>('/integrations').then(setIntegrations).catch((e) => setError(String(e.message)));
    void api<BotSettings>('/bot/settings').then(setBot).catch(() => setBot(null));
  }, []);
  useEffect(() => load(), [load]);

  async function saveWa(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/integrations/whatsapp', { method: 'PUT', json: wa });
      setSaved('WhatsApp configurado');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function saveSifen(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/integrations/sifen', { method: 'PUT', json: sifen });
      setSaved('Datos SIFEN guardados');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function patchBot(patch: Record<string, unknown>) {
    try {
      const updated = await api<BotSettings>('/bot/settings', { method: 'PATCH', json: patch });
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const waConf = integrations.find((i) => i.type === 'whatsapp');
  const sifenConf = integrations.find((i) => i.type === 'sifen');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Ajustes e integraciones</h1>
      <ErrorNote error={error} />
      {saved && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saved}</p>}

      {bot && (
        <section className="rounded-lg border border-violet-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Bot de atencion y agendamiento</h2>
              <p className="text-xs text-slate-500">
                Delega la atencion inmediata: el bot responde y agenda segun los permisos tildados.
                {!bot.engine_available &&
                  ' (El motor de IA aun no esta configurado por el administrador del sistema: el bot esta apagado.)'}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bot.enabled}
                onChange={(e) => void patchBot({ enabled: e.target.checked })}
              />
              Encendido
            </label>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {PERMISOS.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(bot[p.key])}
                  onChange={(e) => {
                    const snake = p.key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
                    void patchBot({ [snake]: e.target.checked });
                  }}
                />
                {p.label}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Field label="Instrucciones del negocio (personalidad del bot, se adapta a tu rubro)">
              <textarea
                className={`${inputClass} h-24`}
                defaultValue={bot.instructionsText ?? ''}
                onBlur={(e) => void patchBot({ instructions_text: e.target.value || null })}
                placeholder="Conta que hace tu negocio y como atender. Ej: Somos un consultorio odontologico; atendemos lunes a viernes de 8 a 17; trata a los pacientes de usted; ante dolor agudo ofrece el primer turno libre del dia."
              />
            </Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Consumo IA de {bot.usage.period}: {(bot.usage.input_tokens + bot.usage.output_tokens).toLocaleString('es-PY')}{' '}
            de {bot.usage.budget.toLocaleString('es-PY')} tokens ({bot.usage.turns} respuestas).
            {bot.usage.exhausted && (
              <span className="font-medium text-red-600">
                {' '}Presupuesto del mes agotado: el bot deriva a tu equipo. El limite lo ajusta el administrador del sistema.
              </span>
            )}
          </p>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">
            WhatsApp {waConf?.configured && <span className="text-xs text-emerald-600">(configurado: {String(waConf.public_config.phone_number_id)})</span>}
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            En el laboratorio usa cualquier identificador (ej. dev-tucano-001) y proba desde /chat.
            Cuando tengas la cuenta de Meta, carga el phone_number_id y token reales y el mismo
            pipeline queda productivo.
          </p>
          <form className="space-y-3" onSubmit={(e) => void saveWa(e)}>
            <Field label="phone_number_id">
              <input className={inputClass} value={wa.phone_number_id} onChange={(e) => setWa({ ...wa, phone_number_id: e.target.value })} required />
            </Field>
            <Field label="Access token">
              <input className={inputClass} value={wa.access_token} onChange={(e) => setWa({ ...wa, access_token: e.target.value })} required />
            </Field>
            <Field label="Verify token">
              <input className={inputClass} value={wa.verify_token} onChange={(e) => setWa({ ...wa, verify_token: e.target.value })} required />
            </Field>
            <button className={buttonClass}>Guardar WhatsApp</button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">
            SIFEN {sifenConf?.configured && <span className="text-xs text-emerald-600">(timbrado {String(sifenConf.public_config.timbrado)})</span>}
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Datos fiscales para numerar y emitir. El certificado .p12 llega con la integracion real.
          </p>
          <form className="space-y-3" onSubmit={(e) => void saveSifen(e)}>
            <Field label="Timbrado (8 digitos)">
              <input className={inputClass} value={sifen.timbrado} onChange={(e) => setSifen({ ...sifen, timbrado: e.target.value })} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Establecimiento">
                <input className={inputClass} value={sifen.establishment} onChange={(e) => setSifen({ ...sifen, establishment: e.target.value })} required />
              </Field>
              <Field label="Punto de expedicion">
                <input className={inputClass} value={sifen.expedition_point} onChange={(e) => setSifen({ ...sifen, expedition_point: e.target.value })} required />
              </Field>
            </div>
            <button className={buttonClass}>Guardar SIFEN</button>
          </form>
        </section>
      </div>
    </div>
  );
}
