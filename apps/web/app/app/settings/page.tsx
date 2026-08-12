'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { formatRucConDv } from '../../../lib/ruc';
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
  instructionsOverride: boolean;
  summariesEnabled: boolean;
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
  { key: 'accessCustomerData', label: 'Puede ver datos del cliente y agendarlo si se presenta en el chat' },
  {
    key: 'summariesEnabled',
    label: 'Resumen automatico al quedar inactiva una conversacion (2 h sin mensajes; consume tokens de IA)',
  },
];

interface TenantMe {
  legalName: string;
  tradeName: string | null;
  ruc: string | null;
  branding: Record<string, unknown>;
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [bot, setBot] = useState<BotSettings | null>(null);
  const [wa, setWa] = useState({ phone_number_id: '', access_token: '', verify_token: 'dev-verify-token', live: false });
  const [sifen, setSifen] = useState({ timbrado: '', establishment: '001', expedition_point: '001', vigencia_desde: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Datos de la empresa + marca: todo lo que se imprime en el KuDE y lo que
  // el bot puede responder (direccion, telefono) se edita aca.
  const [branding, setBranding] = useState<Record<string, unknown>>({});
  const [marca, setMarca] = useState({ logo: '', actividad: '', email_facturacion: '' });
  const [empresa, setEmpresa] = useState({ legal_name: '', trade_name: '', ruc: '' });
  const [branchId, setBranchId] = useState<string | null>(null);
  const [sucursal, setSucursal] = useState({ address: '', phone: '' });

  const load = useCallback(() => {
    void api<Integration[]>('/integrations').then(setIntegrations).catch((e) => setError(String(e.message)));
    void api<BotSettings>('/bot/settings').then(setBot).catch(() => setBot(null));
    void api<TenantMe>('/tenant')
      .then((t) => {
        setBranding(t.branding ?? {});
        setEmpresa({ legal_name: t.legalName, trade_name: t.tradeName ?? '', ruc: t.ruc ?? '' });
        setMarca({
          logo: typeof t.branding?.logo === 'string' ? t.branding.logo : '',
          actividad: typeof t.branding?.actividad === 'string' ? t.branding.actividad : '',
          email_facturacion:
            typeof t.branding?.email_facturacion === 'string' ? t.branding.email_facturacion : '',
        });
      })
      .catch(() => undefined);
    void api<{ id: string; isMain: boolean; address: string | null; phone: string | null }[]>('/branches')
      .then((rows) => {
        const main = rows.find((b) => b.isMain) ?? rows[0];
        if (main) {
          setBranchId(main.id);
          setSucursal({ address: main.address ?? '', phone: main.phone ?? '' });
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  // Retorno del flujo OAuth de Google (?google=connected|error): mensaje y
  // limpieza de la URL para que un F5 no lo repita.
  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get('google');
    if (google === 'connected') setSaved('✓ Google Calendar conectado');
    if (google === 'error') setError('No se pudo conectar Google Calendar: proba de nuevo');
    if (google) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  function onLogoFile(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('El logo debe ser PNG o JPEG');
      return;
    }
    if (file.size > 350_000) {
      setError('El logo no puede superar 350 KB (usa una version reducida)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMarca((m) => ({ ...m, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function saveMarca(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/tenant', {
        method: 'PATCH',
        json: {
          legal_name: empresa.legal_name,
          trade_name: empresa.trade_name || null,
          ruc: empresa.ruc || null,
          branding: {
            ...branding,
            logo: marca.logo || undefined,
            actividad: marca.actividad || undefined,
            email_facturacion: marca.email_facturacion || undefined,
          },
        },
      });
      if (branchId) {
        await api(`/branches/${branchId}`, {
          method: 'PATCH',
          json: { address: sucursal.address || undefined, phone: sucursal.phone || undefined },
        });
      }
      setSaved('Datos de la empresa guardados: se reflejan en el KuDE de las facturas');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

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
      await api('/integrations/sifen', {
        method: 'PUT',
        json: { ...sifen, vigencia_desde: sifen.vigencia_desde || undefined },
      });
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
  const gcalConf = integrations.find((i) => i.type === 'google_calendar');
  const gcalConnected = gcalConf?.configured && gcalConf.public_config.status === 'connected';

  async function connectGoogle() {
    setError(null);
    try {
      const res = await api<{ auth_url: string }>('/integrations/google/connect', {
        method: 'POST',
        json: {},
      });
      window.location.href = res.auth_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function disconnectGoogle() {
    if (!confirm('¿Desconectar Google Calendar? Los turnos dejaran de reflejarse en tu calendario.')) return;
    try {
      await api('/integrations/google_calendar', { method: 'DELETE' });
      void api<Integration[]>('/integrations').then(setIntegrations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Ajustes e integraciones</h1>
      <ErrorNote error={error} />
      {saved && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saved}</p>}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Datos de la empresa y marca</h2>
        <p className="mb-3 text-xs text-slate-500">
          Todo lo que se imprime en el encabezado del KuDE (PDF de tus facturas) se edita aca.
        </p>
        <form className="grid grid-cols-1 items-start gap-4 md:grid-cols-3" onSubmit={(e) => void saveMarca(e)}>
          <Field label="Razon social">
            <input className={inputClass} value={empresa.legal_name} onChange={(e) => setEmpresa({ ...empresa, legal_name: e.target.value })} required />
          </Field>
          <Field label="Nombre de fantasia">
            <input className={inputClass} value={empresa.trade_name} onChange={(e) => setEmpresa({ ...empresa, trade_name: e.target.value })} />
          </Field>
          <Field label="RUC (el DV se completa solo)">
            <input
              className={inputClass}
              placeholder="80012345"
              value={empresa.ruc}
              onChange={(e) => setEmpresa({ ...empresa, ruc: e.target.value })}
              onBlur={(e) => setEmpresa({ ...empresa, ruc: formatRucConDv(e.target.value) })}
            />
          </Field>
          <div className="space-y-2">
            <Field label="Logo (PNG o JPEG, max 350 KB)">
              <input
                className="block w-full text-sm"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => onLogoFile(e.target.files?.[0])}
              />
            </Field>
            {marca.logo && (
              <div className="flex items-center gap-3">
                {/* data URL local: <img> directo, next/image no aplica */}
                <img src={marca.logo} alt="logo" className="h-16 w-16 rounded border border-slate-200 object-contain" />
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setMarca({ ...marca, logo: '' })}>
                  Quitar logo
                </button>
              </div>
            )}
          </div>
          <Field label="Actividad economica">
            <input
              className={inputClass}
              placeholder="Ej: Estudio creativo"
              value={marca.actividad}
              onChange={(e) => setMarca({ ...marca, actividad: e.target.value })}
            />
          </Field>
          <Field label="Direccion (la responde el bot y sale en el KuDE)">
            <input
              className={inputClass}
              placeholder="Avda. ... , Asuncion"
              value={sucursal.address}
              onChange={(e) => setSucursal({ ...sucursal, address: e.target.value })}
            />
          </Field>
          <Field label="Telefono del negocio">
            <input
              className={inputClass}
              placeholder="(0981) 123-456"
              value={sucursal.phone}
              onChange={(e) => setSucursal({ ...sucursal, phone: e.target.value })}
            />
          </Field>
          <div className="space-y-3">
            <Field label="Email de facturacion">
              <input
                className={inputClass}
                type="email"
                value={marca.email_facturacion}
                onChange={(e) => setMarca({ ...marca, email_facturacion: e.target.value })}
              />
            </Field>
            <button className={buttonClass}>Guardar marca</button>
          </div>
        </form>
      </section>

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
                placeholder="Conta que hace tu negocio y como atender. Ej: Somos un estudio creativo; tono cercano y profesional; trata a los clientes de vos; ante consultas de precios ofrece agendar la reunion de diagnostico gratuita."
              />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Texto plano. No hace falta escribir el catalogo ni los precios: el bot los consulta en
              vivo del sistema. Variables disponibles: {'{{nombre_negocio}}'}, {'{{razon_social}}'},{' '}
              {'{{direccion}}'}, {'{{telefono}}'}, {'{{actividad}}'}, {'{{email}}'} — cualquier otra{' '}
              {'{{variable}}'} se elimina.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={bot.instructionsOverride}
                onChange={(e) => void patchBot({ instructions_override: e.target.checked })}
              />
              <span>
                <b>Priorizar mis instrucciones</b> sobre la guia estandar del sistema cuando se
                contradigan.{' '}
                <span className="text-xs text-slate-500">
                  (Consentimiento: entiendo que el comportamiento del bot puede diferir del estandar
                  recomendado. Las reglas de seguridad del sistema rigen siempre y no son anulables.)
                </span>
              </span>
            </label>
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wa.live}
                onChange={(e) => setWa({ ...wa, live: e.target.checked })}
              />
              Envio real por WhatsApp Cloud API (requiere token valido de Meta)
            </label>
            <button className={buttonClass}>Guardar WhatsApp</button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">
            Google Calendar{' '}
            {gcalConnected ? (
              <span className="text-xs text-emerald-600">
                (conectado{gcalConf?.public_config.connected_email ? `: ${String(gcalConf.public_config.connected_email)}` : ''})
              </span>
            ) : gcalConf?.configured ? (
              <span className="text-xs text-red-600">(desconectado: reconecta)</span>
            ) : null}
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Conecta el calendario de Google de tu negocio: cada turno agendado aparece como evento,
            las cancelaciones lo quitan, y los eventos que cargues a mano en Google bloquean esos
            horarios en la agenda (nadie te agenda encima). Se conecta UNA vez con tu cuenta de
            Google; podes desconectarla cuando quieras.
          </p>
          <div className="flex items-center gap-2">
            <button className={buttonClass} onClick={() => void connectGoogle()}>
              {gcalConf?.configured ? 'Reconectar' : 'Conectar Google Calendar'}
            </button>
            {gcalConf?.configured && (
              <button
                className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                onClick={() => void disconnectGoogle()}
              >
                Desconectar
              </button>
            )}
          </div>
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
            <Field label="Inicio de vigencia del timbrado (se imprime en el KuDE)">
              <input className={inputClass} type="date" value={sifen.vigencia_desde} onChange={(e) => setSifen({ ...sifen, vigencia_desde: e.target.value })} />
            </Field>
            <button className={buttonClass}>Guardar SIFEN</button>
          </form>
        </section>
      </div>
    </div>
  );
}
