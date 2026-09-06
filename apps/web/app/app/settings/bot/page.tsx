'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../../lib/api';
import { avisosDeIndicaciones } from '../../../../lib/bot-indicaciones';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Card, ErrorNote, Field, inputClass } from '../../../../lib/ui';

// Bot de WhatsApp (fase 2 auditoria de paneles 2026-09-05): cada permiso
// explica que hace y que pasa si se apaga (patron de Empleados); "se confirman
// solos" cuelga de "puede agendar"; todo se guarda al instante con un aviso
// visible; el uso de IA es una barra, no una linea gris al pie.

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
  const [instrDraft, setInstrDraft] = useState('');
  const [link, setLink] = useState('');
  const [plantilla, setPlantilla] = useState({ template: '', lang: 'es' });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    api<BotSettings>('/bot/settings')
      .then((b) => {
        setBot(b);
        setInstrDraft(b.instructionsText ?? '');
        setLink(b.virtualMeetingLink ?? '');
        setPlantilla({ template: b.reminderTemplate ?? '', lang: b.reminderTemplateLang || 'es' });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración del bot. Puede que tu plan no incluya el bot.')));
  }, []);
  useEffect(() => load(), [load]);

  async function patch(json: Record<string, unknown>) {
    try {
      const updated = await api<BotSettings>('/bot/settings', { method: 'PATCH', json });
      setBot((prev) => (prev ? { ...prev, ...updated } : prev));
      setSavedAt(Date.now());
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      toast.error(errorMessage(e));
      load();
    }
  }

  if (!bot) return <ErrorNote error={error} />;

  const encendido = bot.enabled && bot.engine_available;
  const usado = bot.usage.input_tokens + bot.usage.output_tokens;
  const pct = bot.usage.budget > 0 ? Math.min(100, Math.round((usado / bot.usage.budget) * 100)) : null;
  const guardado = savedAt ? <span className="text-xs text-emerald-600">Guardado ✓</span> : <span className="text-xs text-slate-400">Se guarda solo</span>;

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
            ? 'Responde por WhatsApp como una persona más del equipo, con los datos reales de tu Catálogo y tu Agenda. Marcá qué le permitís hacer.'
            : 'El motor de inteligencia artificial todavía no está configurado por el administrador del sistema: el bot está apagado aunque lo enciendas acá.'
        }
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bot.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
            Encendido
            {guardado}
          </label>
        }
      >
        <ul className="divide-y divide-slate-100">
          {PERMISOS.map((p) => {
            const bloqueado = p.dependeDe ? !bot[p.dependeDe] : false;
            return (
              <li key={p.key} className={`py-2 ${p.dependeDe ? 'pl-7' : ''} ${bloqueado ? 'opacity-50' : ''}`}>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(bot[p.key])}
                    disabled={bloqueado}
                    onChange={(e) => void patch({ [snake(p.key)]: e.target.checked })}
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

        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <div>
            <Field label="Videollamadas: link fijo de Meet o Zoom (vacío = el bot no ofrece videollamadas)">
              <input
                className={inputClass}
                type="url"
                value={link}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                onChange={(e) => setLink(e.target.value)}
                onBlur={() => {
                  const v = link.trim() || null;
                  if (v !== (bot.virtualMeetingLink ?? null)) void patch({ virtual_meeting_link: v });
                }}
              />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Con link, el bot ofrece atención virtual y lo entrega al confirmar la reserva. Sin link, si un cliente pide videollamada le aclara que la atención es presencial.
            </p>
          </div>

          <div>
            <Field label="Indicaciones del negocio (cómo querés que atienda: tono, políticas, qué recomendar)">
              <textarea
                className={`${inputClass} h-28`}
                value={instrDraft}
                onChange={(e) => setInstrDraft(e.target.value)}
                onBlur={() => {
                  const v = instrDraft.trim() || null;
                  if (v !== (bot.instructionsText ?? null)) void patch({ instructions_text: v });
                }}
                placeholder="Ej: Somos un estudio creativo; tono cercano y profesional; tratá a los clientes de vos; ante consultas de precios ofrecé agendar la reunión de diagnóstico gratuita; los sábados no hacemos coloración."
              />
            </Field>
            {avisosDeIndicaciones(instrDraft).length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">Ojo: hay cosas en este texto que el bot ya toma del sistema. Si quedan las dos versiones, se confunde y responde mal.</p>
                <ul className="ml-4 mt-1 list-disc space-y-0.5">
                  {avisosDeIndicaciones(instrDraft).map((a) => (
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
              <input
                type="checkbox"
                className="mt-0.5"
                checked={bot.instructionsOverride}
                onChange={(e) => void patch({ instructions_override: e.target.checked })}
              />
              <span>
                <b>Priorizar mis indicaciones</b> sobre la guía estándar del sistema cuando se contradigan en tono o políticas.{' '}
                <span className="text-xs text-slate-500">
                  Los datos del sistema (catálogo, horarios, equipo) y las reglas de seguridad mandan siempre igual.
                </span>
              </span>
            </label>
          </div>
        </div>
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
        description="El sistema le escribe solo al cliente antes de su turno. El mensaje queda en la bandeja como cualquier conversación; si el cliente responde, se atiende normal."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bot.reminderEnabled} onChange={(e) => void patch({ reminder_enabled: e.target.checked })} />
            Activados
            {guardado}
          </label>
        }
      >
        {bot.reminderEnabled ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Cuánto antes del turno">
              <select className={inputClass} value={bot.reminderHours} onChange={(e) => void patch({ reminder_hours: Number(e.target.value) })}>
                <option value={2}>2 horas antes</option>
                <option value={6}>6 horas antes</option>
                <option value={12}>12 horas antes</option>
                <option value={24}>24 horas antes</option>
                <option value={48}>48 horas antes</option>
              </select>
            </Field>
            <Field label="Plantilla aprobada por Meta (solo con envío real)">
              <input
                className={inputClass}
                placeholder="ej: recordatorio_turno"
                value={plantilla.template}
                onChange={(e) => setPlantilla({ ...plantilla, template: e.target.value })}
                onBlur={() => {
                  const v = plantilla.template.trim() || null;
                  if (v !== (bot.reminderTemplate ?? null)) void patch({ reminder_template: v });
                }}
              />
            </Field>
            <Field label="Idioma de la plantilla">
              <input
                className={inputClass}
                value={plantilla.lang}
                onChange={(e) => setPlantilla({ ...plantilla, lang: e.target.value })}
                onBlur={() => {
                  const v = plantilla.lang.trim() || 'es';
                  if (v !== bot.reminderTemplateLang) void patch({ reminder_template_lang: v });
                }}
              />
            </Field>
            <p className="col-span-2 self-end text-xs text-slate-400 md:col-span-1">
              Con envío real, Meta exige una plantilla aprobada en tu cuenta para escribir primero; sin plantilla el recordatorio solo llega si el cliente escribió en las últimas 24 h.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Activalos para que ningún cliente se olvide de su turno.</p>
        )}
      </Card>
    </>
  );
}
