'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../../lib/api';
import { avisosDeIndicaciones } from '../../../../lib/bot-indicaciones';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, inputClass } from '../../../../lib/ui';

// Bot de WhatsApp. Flujo de guardado unificado (pedido de Johan 2026-09-07):
// los interruptores se aplican al instante y avisan con un texto flotante
// "Cambio guardado" (o el error); los campos de texto se guardan con el
// boton Guardar de su bloque, como en el resto de Ajustes. Antes todo se
// guardaba solo al salir del campo, con un chip chico que nadie veia.

interface BotSettings {
  enabled: boolean;
  instructionsText: string | null;
  virtualMeetingLink: string | null;
  reminderEnabled: boolean;
  reminderHours: number;
  reminderTemplate: string | null;
  reminderTemplateLang: string;
  accessCatalog: boolean;
  accessHistory: boolean;
  accessCustomerData: boolean;
  accessCalendar: boolean;
  allowBooking: boolean;
  autoConfirmBookings: boolean;
  instructionsOverride: boolean;
  summariesEnabled: boolean;
  engine_available: boolean;
  usage: { period: string; input_tokens: number; output_tokens: number; turns: number; budget: number; exhausted: boolean };
}

type PermKey = 'accessCatalog' | 'accessCalendar' | 'allowBooking' | 'autoConfirmBookings' | 'accessCustomerData' | 'accessHistory' | 'summariesEnabled';

const PERMISOS: { key: PermKey; titulo: string; detalle: string; dependeDe?: PermKey }[] = [
  {
    key: 'accessCatalog',
    titulo: 'Consulta el catálogo y los precios',
    detalle: 'Responde qué ofrecés y cuánto cuesta con los datos reales del Catálogo. Apagado: ante esas preguntas deriva a una persona.',
  },
  {
    key: 'accessCalendar',
    titulo: 'Consulta la disponibilidad de la agenda',
    detalle: 'Ofrece solo horarios realmente libres. Apagado: no habla de horarios.',
  },
  {
    key: 'allowBooking',
    titulo: 'Agenda, cambia y cancela turnos',
    detalle: 'Reserva con la confirmación del cliente; también reprograma y cancela sus propios turnos. Apagado: informa y deriva, no toca la agenda.',
  },
  {
    key: 'autoConfirmBookings',
    titulo: 'Los turnos que agenda quedan confirmados',
    detalle: 'Apagado: entran como "a confirmar" y alguien del equipo los confirma desde la Agenda.',
    dependeDe: 'allowBooking',
  },
  {
    key: 'accessCustomerData',
    titulo: 'Registra al cliente y completa su ficha',
    detalle: 'Guarda nombre, email o documento cuando el cliente los da, de a uno y sin insistir. Registrarse nunca es obligatorio para ser atendido.',
  },
  {
    key: 'accessHistory',
    titulo: 'Ve el historial de visitas del cliente',
    detalle: 'Para responder "¿cuándo fue mi último turno?" con datos reales.',
  },
  {
    key: 'summariesEnabled',
    titulo: 'Resume la conversación cuando queda inactiva',
    detalle: 'Tras 2 horas sin mensajes arma un resumen para tu equipo y, si quedó algo pendiente, crea una tarea de seguimiento. Consume uso de IA.',
  },
];

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export default function BotPage() {
  const toast = useToast();
  const [bot, setBot] = useState<BotSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bloque "Cómo atiende": se guarda con su boton.
  const [atencion, setAtencion] = useState({ link: '', instrucciones: '', priorizar: false });
  const [guardandoAtencion, setGuardandoAtencion] = useState(false);
  // Bloque "Recordatorios": idem.
  const [recordatorio, setRecordatorio] = useState({ horas: 24, plantilla: '', idioma: 'es' });
  const [guardandoRecordatorio, setGuardandoRecordatorio] = useState(false);
  // Que interruptor esta aplicandose (para deshabilitarlo mientras tanto).
  const [aplicando, setAplicando] = useState<string | null>(null);

  const hidratar = (b: BotSettings) => {
    setBot(b);
    setAtencion({ link: b.virtualMeetingLink ?? '', instrucciones: b.instructionsText ?? '', priorizar: b.instructionsOverride });
    setRecordatorio({ horas: b.reminderHours, plantilla: b.reminderTemplate ?? '', idioma: b.reminderTemplateLang || 'es' });
  };

  const load = useCallback(() => {
    api<BotSettings>('/bot/settings')
      .then(hidratar)
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración del bot. Puede que tu plan no incluya el bot.')));
  }, []);
  useEffect(() => load(), [load]);

  /** Interruptores: se aplican al instante y avisan. */
  async function aplicar(campo: string, valor: boolean, aviso?: string) {
    setAplicando(campo);
    try {
      const updated = await api<BotSettings>('/bot/settings', { method: 'PATCH', json: { [campo]: valor } });
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success(aviso ?? 'Cambio guardado');
    } catch (e) {
      toast.error(errorMessage(e, 'No se pudo guardar el cambio.'));
      load();
    } finally {
      setAplicando(null);
    }
  }

  async function guardarAtencion(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoAtencion(true);
    try {
      const updated = await api<BotSettings>('/bot/settings', {
        method: 'PATCH',
        json: {
          virtual_meeting_link: atencion.link.trim() || null,
          instructions_text: atencion.instrucciones.trim() || null,
          instructions_override: atencion.priorizar,
        },
      });
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success('Indicaciones del bot guardadas');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoAtencion(false);
    }
  }

  async function guardarRecordatorio(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoRecordatorio(true);
    try {
      const updated = await api<BotSettings>('/bot/settings', {
        method: 'PATCH',
        json: {
          reminder_hours: recordatorio.horas,
          reminder_template: recordatorio.plantilla.trim() || null,
          reminder_template_lang: recordatorio.idioma.trim() || 'es',
        },
      });
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success('Recordatorios guardados');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoRecordatorio(false);
    }
  }

  if (!bot) return <ErrorNote error={error} />;

  const encendido = bot.enabled && bot.engine_available;
  const usado = bot.usage.input_tokens + bot.usage.output_tokens;
  const pct = bot.usage.budget > 0 ? Math.min(100, Math.round((usado / bot.usage.budget) * 100)) : null;
  const avisos = avisosDeIndicaciones(atencion.instrucciones);
  const atencionSucia =
    atencion.link.trim() !== (bot.virtualMeetingLink ?? '') ||
    atencion.instrucciones.trim() !== (bot.instructionsText ?? '') ||
    atencion.priorizar !== bot.instructionsOverride;
  const recordatorioSucio =
    recordatorio.horas !== bot.reminderHours ||
    recordatorio.plantilla.trim() !== (bot.reminderTemplate ?? '') ||
    (recordatorio.idioma.trim() || 'es') !== (bot.reminderTemplateLang || 'es');

  return (
    <>
      <Card
        tone="violet"
        title={
          <span className="inline-flex items-center gap-2">
            Bot de atención y agendamiento
            <Badge tone={encendido ? 'violet' : 'slate'}>{encendido ? 'encendido' : 'apagado'}</Badge>
          </span>
        }
        description={
          bot.engine_available
            ? 'Responde por WhatsApp como una persona más del equipo, con los datos reales de tu Catálogo y tu Agenda. Marcá qué le permitís hacer: cada interruptor se aplica al instante.'
            : 'El motor de inteligencia artificial todavía no está configurado por el administrador del sistema: el bot está apagado aunque lo enciendas acá.'
        }
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bot.enabled}
              disabled={aplicando === 'enabled'}
              onChange={(e) => void aplicar('enabled', e.target.checked, e.target.checked ? 'Cambio guardado: bot encendido' : 'Cambio guardado: bot apagado')}
            />
            Encendido
          </label>
        }
      >
        <ul className="divide-y divide-slate-100">
          {PERMISOS.map((p) => {
            const bloqueado = p.dependeDe ? !bot[p.dependeDe] : false;
            const campo = snake(p.key);
            return (
              <li key={p.key} className={`py-2 ${p.dependeDe ? 'pl-7' : ''} ${bloqueado ? 'opacity-50' : ''}`}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(bot[p.key])}
                    disabled={bloqueado || aplicando === campo}
                    onChange={(e) => void aplicar(campo, e.target.checked)}
                  />
                  <span>
                    <b>{p.titulo}</b>
                    <span className="block text-xs text-slate-500">
                      {p.detalle}
                      {bloqueado && ' (Necesita "Agenda, cambia y cancela turnos".)'}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Cómo atiende" description="Videollamadas e indicaciones propias de tu negocio. Estos campos se guardan con el botón.">
        <form className="space-y-4" onSubmit={(e) => void guardarAtencion(e)}>
          <div>
            <Field label="Videollamadas: link fijo de Meet o Zoom (vacío = el bot no ofrece videollamadas)">
              <input className={inputClass} type="url" value={atencion.link} placeholder="https://meet.google.com/xxx-xxxx-xxx" onChange={(e) => setAtencion({ ...atencion, link: e.target.value })} />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Con link, el bot ofrece atención virtual y lo entrega al confirmar la reserva. Sin link, si un cliente pide videollamada le aclara que la atención es presencial.
            </p>
          </div>

          <div>
            <Field label="Indicaciones del negocio (cómo querés que atienda: tono, políticas, qué recomendar)">
              <textarea
                className={`${inputClass} h-28`}
                value={atencion.instrucciones}
                onChange={(e) => setAtencion({ ...atencion, instrucciones: e.target.value })}
                placeholder="Ej: Somos un estudio creativo; tono cercano y profesional; tratá a los clientes de vos; ante consultas de precios ofrecé agendar la reunión de diagnóstico gratuita; los sábados no hacemos coloración."
              />
            </Field>
            {avisos.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">Ojo: hay cosas en este texto que el bot ya toma del sistema. Si quedan las dos versiones, se confunde y responde mal.</p>
                <ul className="ml-4 mt-1 list-disc space-y-0.5">
                  {avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-1 text-xs text-slate-400">
              <b>Sí va acá:</b> el tono, cómo tratar al cliente, qué recomendar, políticas propias (señas, cancelaciones, promociones vigentes).{' '}
              <b>No va acá:</b> horarios, precios ni la lista de servicios (el bot los toma de{' '}
              <Link className="underline" href="/app/settings/horarios">
                Horarios
              </Link>{' '}
              y{' '}
              <Link className="underline" href="/app/catalog">
                Catálogo
              </Link>
              ), ni pedir nombre o teléfono como requisito. Variables: {'{{nombre_negocio}}'}, {'{{razon_social}}'}, {'{{direccion}}'},{' '}
              {'{{telefono}}'}, {'{{actividad}}'}, {'{{email}}'}.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={atencion.priorizar} onChange={(e) => setAtencion({ ...atencion, priorizar: e.target.checked })} />
              <span>
                <b>Priorizar mis indicaciones</b> sobre la guía estándar del sistema cuando se contradigan en tono o políticas.{' '}
                <span className="text-xs text-slate-500">Los datos del sistema (catálogo, horarios, equipo) y las reglas de seguridad mandan siempre igual.</span>
              </span>
            </label>
          </div>
          <div className="flex items-center justify-end gap-3">
            {atencionSucia && <span className="text-xs text-amber-700">Hay cambios sin guardar</span>}
            <Button variant="primary" type="submit" loading={guardandoAtencion}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Uso de inteligencia artificial" description={`Lo que el bot consumió en ${bot.usage.period}. El límite mensual lo define el administrador del sistema según tu plan.`}>
        {pct === null ? (
          <p className="text-sm text-slate-500">Sin límite configurado. {bot.usage.turns} respuestas dadas este mes.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>
                {pct}% del límite mensual · {bot.usage.turns} respuesta{bot.usage.turns === 1 ? '' : 's'}
              </span>
              {bot.usage.exhausted && <span className="font-medium text-red-600">Límite agotado</span>}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {bot.usage.exhausted && (
              <p className="text-xs text-red-600">
                El bot dejó de responder por su cuenta hasta el mes que viene: cada chat nuevo queda marcado para que lo atienda tu equipo. Si necesitás más, pedile al administrador del sistema que suba el límite.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Recordatorios de turnos por WhatsApp
            <Badge tone={bot.reminderEnabled ? 'emerald' : 'slate'}>{bot.reminderEnabled ? 'activados' : 'desactivados'}</Badge>
          </span>
        }
        description="El sistema le escribe solo al cliente antes de su turno. El mensaje queda en la bandeja como cualquier conversación; si el cliente responde, se atiende normal. El interruptor se aplica al instante; los demás campos se guardan con el botón."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bot.reminderEnabled}
              disabled={aplicando === 'reminder_enabled'}
              onChange={(e) => void aplicar('reminder_enabled', e.target.checked, e.target.checked ? 'Cambio guardado: recordatorios activados' : 'Cambio guardado: recordatorios desactivados')}
            />
            Activados
          </label>
        }
      >
        {bot.reminderEnabled ? (
          <form className="space-y-3" onSubmit={(e) => void guardarRecordatorio(e)}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Cuánto antes del turno">
                <select className={inputClass} value={recordatorio.horas} onChange={(e) => setRecordatorio({ ...recordatorio, horas: Number(e.target.value) })}>
                  <option value={2}>2 horas antes</option>
                  <option value={6}>6 horas antes</option>
                  <option value={12}>12 horas antes</option>
                  <option value={24}>24 horas antes</option>
                  <option value={48}>48 horas antes</option>
                </select>
              </Field>
              <Field label="Plantilla aprobada por Meta (solo con envío real)">
                <input className={inputClass} placeholder="ej: recordatorio_turno" value={recordatorio.plantilla} onChange={(e) => setRecordatorio({ ...recordatorio, plantilla: e.target.value })} />
              </Field>
              <Field label="Idioma de la plantilla">
                <input className={inputClass} value={recordatorio.idioma} onChange={(e) => setRecordatorio({ ...recordatorio, idioma: e.target.value })} />
              </Field>
              <p className="col-span-2 self-end text-xs text-slate-400 md:col-span-1">
                Con envío real, Meta exige una plantilla aprobada en tu cuenta para escribir primero; sin plantilla el recordatorio solo llega si el cliente escribió en las últimas 24 h.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3">
              {recordatorioSucio && <span className="text-xs text-amber-700">Hay cambios sin guardar</span>}
              <Button variant="primary" type="submit" loading={guardandoRecordatorio}>
                Guardar
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-slate-400">Activalos para que ningún cliente se olvide de su turno.</p>
        )}
      </Card>
    </>
  );
}
