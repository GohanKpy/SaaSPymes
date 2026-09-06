'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { api, sseUrl } from '../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../lib/customer-picker';
import { useToast } from '../../../lib/feedback';
import { APPOINTMENT_STATUS, CONVERSATION_STATUS, SENDER_LABEL, errorMessage, statusOf } from '../../../lib/labels';
import {
  Badge,
  Button,
  ErrorNote,
  LoadMore,
  PageHeader,
  buttonClass,
  buttonGhost,
  buttonSoft,
  dt,
  inputClass,
} from '../../../lib/ui';

// Bandeja de chat (fase 1 auditoria de paneles 2026-09-05): panel del cliente
// al lado de la conversacion (ficha, proximos turnos, agendar), filtros por
// estado y "necesita una persona", marcar resuelta, y el tutorial de prueba
// plegado despues de la primera vez.

const TZ = 'America/Asuncion';
const VISTO_KEY = 'inbox_prueba_visto';

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}
interface Conversation {
  id: string;
  phoneE164: string;
  status: string;
  needsHuman?: boolean;
  lastMessageAt: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    docNumber: string | null;
    phoneE164: string | null;
  } | null;
}
interface Message {
  id: string;
  conversation_id?: string;
  conversationId?: string;
  direction: string;
  sender_type?: string;
  senderType?: string;
  body: string;
  created_at?: string;
  createdAt?: string;
}
interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  lastConversationSummary: string | null;
  lastSummaryAt: string | null;
}
interface Appointment {
  id: string;
  startsAt: string;
  status: string;
  service: { name: string } | null;
  employee: { firstName: string; lastName: string } | null;
}

const norm = (m: Message): Message => ({
  ...m,
  conversation_id: m.conversation_id ?? m.conversationId,
  sender_type: m.sender_type ?? m.senderType,
  created_at: m.created_at ?? m.createdAt,
});

function nombreConv(c: Conversation): string {
  return c.customer ? customerName(c.customer) : c.phoneE164;
}

/** Como probar el bot sin WhatsApp real. Plegado tras la primera vez. */
function PanelDePrueba() {
  const [wa, setWa] = useState<Integration | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    void api<Integration[]>('/integrations')
      .then((rows) => setWa(rows.find((i) => i.type === 'whatsapp') ?? null))
      .catch(() => undefined);
    try {
      setAbierto(localStorage.getItem(VISTO_KEY) !== '1');
    } catch {
      setAbierto(true);
    }
  }, []);

  const id = typeof wa?.public_config.phone_number_id === 'string' ? wa.public_config.phone_number_id : '';
  const live = wa?.public_config.live === true;

  const plegar = (valor: boolean) => {
    setAbierto(valor);
    try {
      if (!valor) localStorage.setItem(VISTO_KEY, '1');
    } catch {
      /* sin storage */
    }
  };

  if (!wa?.configured || !id) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <b>Para probar tu bot falta un paso.</b> Andá a{' '}
        <Link className="font-medium underline" href="/app/settings">
          Ajustes → WhatsApp
        </Link>{' '}
        y cargá el identificador de tu negocio (durante las pruebas puede ser cualquier nombre, por ejemplo{' '}
        <code className="rounded bg-white px-1">dev-mi-negocio</code>). Después volvé acá y vas a poder escribirle a tu
        bot como si fueras un cliente.
      </div>
    );
  }

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <span>
          {live
            ? 'Tu WhatsApp real está conectado: escribile a tu número y la conversación aparece acá.'
            : 'Probá tu bot como si fueras un cliente desde el chat de prueba.'}
        </span>
        <span className="flex items-center gap-2">
          {!live && (
            <a className={buttonSoft} href={`/chat?negocio=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
              Abrir chat de prueba
            </a>
          )}
          <button className="text-sky-700 hover:underline" onClick={() => plegar(true)}>
            ver cómo
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <b>Probá tu bot como si fueras un cliente.</b>{' '}
          {live
            ? 'Tu WhatsApp real ya está conectado: escribile a tu número desde tu celular y la conversación aparece acá.'
            : 'Abrí el chat de prueba y escribí: los mensajes entran a esta bandeja igual que los de WhatsApp.'}
        </div>
        <button className="shrink-0 text-xs text-sky-700 hover:underline" onClick={() => plegar(false)}>
          ocultar
        </button>
      </div>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-sky-800">Identificador de tu negocio:</span>
          <code className="rounded-md border border-sky-200 bg-white px-2 py-1 font-mono text-sm font-medium">{id}</code>
          <button
            className={buttonGhost}
            onClick={() => {
              void navigator.clipboard.writeText(id).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              });
            }}
          >
            {copiado ? '✓ Copiado' : 'Copiar'}
          </button>
          <a className={buttonClass} href={`/chat?negocio=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
            Abrir chat de prueba
          </a>
        </div>
        <ol className="ml-4 list-decimal space-y-0.5 text-xs text-sky-900">
          <li>
            Tocá <b>Abrir chat de prueba</b>: se abre en otra pestaña con tu identificador ya puesto.
          </li>
          <li>Poné un número de celular cualquiera para hacer de cliente y escribí un mensaje.</li>
          <li>La conversación aparece en esta bandeja y tu bot responde solo.</li>
        </ol>
      </div>
    </div>
  );
}

/** Quien es el cliente de esta conversacion y que tiene agendado. */
function PanelCliente({ conversation, onLinked }: { conversation: Conversation; onLinked: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [turnos, setTurnos] = useState<Appointment[] | null>(null);
  const [linking, setLinking] = useState<PickedCustomer | null>(null);
  const customerId = conversation.customer?.id;

  useEffect(() => {
    setDetail(null);
    setTurnos(null);
    if (!customerId) return;
    void api<CustomerDetail>(`/customers/${customerId}`).then(setDetail).catch(() => undefined);
    const from = new Date().toISOString();
    void api<Appointment[]>(`/appointments?customer_id=${customerId}&from=${encodeURIComponent(from)}`)
      .then((r) => setTurnos(r.filter((a) => ['pending', 'confirmed'].includes(a.status)).slice(0, 3)))
      .catch(() => setTurnos([]));
  }, [customerId]);

  async function vincular() {
    if (!linking) return;
    try {
      await api(`/conversations/${conversation.id}/link-customer`, {
        method: 'POST',
        json: { customer_id: linking.id },
      });
      toast.success(`Conversación vinculada a ${customerName(linking)}`);
      setLinking(null);
      onLinked();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const tel = conversation.customer?.phoneE164 ?? conversation.phoneE164;
  const waLink = tel ? `https://wa.me/${tel.replace(/\D/g, '')}` : null;

  if (!conversation.customer) {
    return (
      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-slate-100 p-3 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Cliente</p>
          <p className="mt-1 font-medium text-slate-900">{conversation.phoneE164}</p>
          <p className="text-xs text-slate-500">Todavía no está vinculado a ninguna ficha.</p>
        </div>
        <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2">
          <p className="text-xs text-slate-600">Vinculá esta conversación a un cliente (o crealo):</p>
          <CustomerPicker value={linking} onChange={setLinking} placeholder="Buscar o crear cliente…" />
          {linking && (
            <Button variant="primary" className="w-full" onClick={() => void vincular()}>
              Vincular
            </Button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-slate-100 p-3 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Cliente</p>
        <p className="mt-1 font-medium text-slate-900">{customerName(conversation.customer)}</p>
        {tel && <p className="text-xs text-slate-500">{tel}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link className={buttonSoft} href={`/app/customers/${conversation.customer.id}`}>
            Abrir ficha
          </Link>
          <Link className={buttonGhost} href={`/app/schedule?nuevo=1&customer=${conversation.customer.id}`}>
            Agendar turno
          </Link>
          {waLink && (
            <a className={buttonGhost} href={waLink} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Próximos turnos</p>
        {turnos === null && <p className="mt-1 text-xs text-slate-400">Buscando…</p>}
        {turnos && turnos.length === 0 && <p className="mt-1 text-xs text-slate-400">No tiene turnos próximos.</p>}
        <ul className="mt-1 space-y-1.5">
          {(turnos ?? []).map((a) => {
            const st = statusOf(APPOINTMENT_STATUS, a.status);
            return (
              <li key={a.id} className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{dt(a.startsAt)}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <span className="text-xs text-slate-500">
                  {a.service?.name ?? 'Turno'}
                  {a.employee ? ` · ${a.employee.firstName} ${a.employee.lastName}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
        {turnos && turnos.length > 0 && (
          <Link
            className="mt-1 inline-block text-xs text-sky-700 hover:underline"
            href={`/app/schedule?fecha=${new Date(turnos[0]!.startsAt).toLocaleDateString('en-CA', { timeZone: TZ })}`}
          >
            Ver en la agenda →
          </Link>
        )}
      </div>

      {detail?.lastConversationSummary && (
        <div className="rounded-md border border-violet-200 bg-violet-50/50 p-2">
          <p className="text-xs font-medium text-violet-800">
            Resumen del bot{detail.lastSummaryAt ? ` · ${dt(detail.lastSummaryAt)}` : ''}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-slate-700">{detail.lastConversationSummary}</p>
        </div>
      )}
    </aside>
  );
}

export default function InboxPage() {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [estado, setEstado] = useState('');
  const [soloHumano, setSoloHumano] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingCustomer = useRef<string | null>(null);

  const loadConversations = useCallback(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (estado) params.set('status', estado);
    api<{ data: Conversation[]; next_cursor: string | null }>(`/conversations?${params.toString()}`)
      .then((r) => {
        setConversations(r.data);
        setNextCursor(r.next_cursor);
        setError(null);
        // Llegada desde una ficha (?customer=): abrir su conversacion.
        if (pendingCustomer.current) {
          const hit = r.data.find((c) => c.customer?.id === pendingCustomer.current);
          if (hit) {
            setSelected(hit.id);
            setFilter(nombreConv(hit));
            loadMessages(hit.id);
          }
          pendingCustomer.current = null;
        }
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar las conversaciones.')));
  }, [estado]);

  const loadMessages = useCallback((id: string) => {
    void api<{ data: Message[] }>(`/conversations/${id}/messages`)
      .then((r) => setMessages(r.data.map(norm)))
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('humano') === '1') setSoloHumano(true);
    const c = q.get('customer');
    if (c) pendingCustomer.current = c;
  }, []);
  useEffect(() => loadConversations(), [loadConversations]);

  // SSE en vivo (doc 04 §3.7): mensajes nuevos y cambios de conversacion.
  useEffect(() => {
    const source = new EventSource(sseUrl('/conversations/stream'));
    const onMessage = (e: MessageEvent) => {
      const payload = norm(JSON.parse(e.data as string) as Message);
      setMessages((prev) =>
        selected && payload.conversation_id === selected && !prev.some((m) => m.id === payload.id)
          ? [...prev, payload]
          : prev,
      );
      loadConversations();
    };
    source.addEventListener('message.new', onMessage);
    source.addEventListener('conversation.updated', () => loadConversations());
    return () => source.close();
  }, [selected, loadConversations]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '50', cursor: nextCursor });
      if (estado) params.set('status', estado);
      const r = await api<{ data: Conversation[]; next_cursor: string | null }>(`/conversations?${params.toString()}`);
      setConversations((prev) => [...prev, ...r.data]);
      setNextCursor(r.next_cursor);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const visible = conversations.filter((c) => {
    if (soloHumano && !c.needsHuman) return false;
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    const haystack = [c.phoneE164, c.customer?.firstName, c.customer?.lastName, c.customer?.email, c.customer?.docNumber, c.customer?.phoneE164]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setEnviando(true);
    try {
      await api(`/conversations/${selected}/messages`, { method: 'POST', json: { body: draft.trim() } });
      setDraft('');
      loadMessages(selected);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarEstado(conv: Conversation, verb: 'pause' | 'resume' | 'close') {
    try {
      await api(`/conversations/${conv.id}/${verb}`, { method: 'POST', json: {} });
      toast.success(
        verb === 'pause'
          ? 'Bot pausado en esta conversación: la atendés vos'
          : verb === 'resume'
            ? 'El bot vuelve a responder en esta conversación'
            : 'Conversación marcada como resuelta',
      );
      loadConversations();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const current = conversations.find((c) => c.id === selected);
  const needHumanCount = conversations.filter((c) => c.needsHuman).length;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Chat"
        description="Las conversaciones de WhatsApp de tu negocio. El bot responde solo; vos entrás cuando hace falta."
      />
      <PanelDePrueba />
      <ErrorNote error={error} />
      <div className="grid h-[calc(100vh-260px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-[280px_1fr] lg:grid-cols-[300px_1fr_280px]">
        <aside className="flex min-h-0 flex-col border-r border-slate-100">
          <div className="space-y-2 border-b border-slate-100 p-2">
            <input
              className={inputClass}
              placeholder="Buscar: nombre, celular, email, documento…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputClass} max-w-[170px] py-1 text-xs`} value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="">Todas las abiertas</option>
                <option value="bot_active">Bot activo</option>
                <option value="paused">Bot pausado</option>
                <option value="agent">Con agente</option>
                <option value="inactive">Inactivas</option>
                <option value="closed">Resueltas</option>
              </select>
              <label className={`flex items-center gap-1.5 text-xs ${needHumanCount > 0 ? 'text-red-700' : 'text-slate-600'}`}>
                <input type="checkbox" checked={soloHumano} onChange={(e) => setSoloHumano(e.target.checked)} />
                Necesitan una persona{needHumanCount > 0 ? ` (${needHumanCount})` : ''}
              </label>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((c) => {
              const st = statusOf(CONVERSATION_STATUS, c.status);
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelected(c.id);
                    loadMessages(c.id);
                  }}
                  className={`block w-full border-b border-l-2 border-slate-50 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                    selected === c.id ? 'border-l-sky-600 bg-sky-50' : 'border-l-transparent'
                  }`}
                >
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{nombreConv(c)}</span>
                    {c.needsHuman && <Badge tone="red">Necesita una persona</Badge>}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="truncate">{c.customer ? c.phoneE164 : ''}</span>
                    <span className="ml-auto shrink-0">{dt(c.lastMessageAt)}</span>
                  </p>
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="p-4 text-sm text-slate-400">
                {conversations.length === 0
                  ? 'Todavía no hay conversaciones. Cuando un cliente escriba (o pruebes el chat), aparece acá.'
                  : soloHumano
                    ? 'Ninguna conversación necesita una persona ahora.'
                    : 'Ninguna conversación coincide con la búsqueda.'}
              </p>
            )}
            <LoadMore nextCursor={nextCursor} loading={loadingMore} onLoad={() => void loadMore()} />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {current ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{nombreConv(current)}</span>
                  <Badge tone={statusOf(CONVERSATION_STATUS, current.status).tone}>
                    {statusOf(CONVERSATION_STATUS, current.status).label}
                  </Badge>
                  {current.needsHuman && <Badge tone="red">El bot no pudo resolverlo: te toca a vos</Badge>}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {current.status === 'closed' ? (
                    <button className={buttonGhost} onClick={() => void cambiarEstado(current, 'resume')}>
                      Reabrir
                    </button>
                  ) : (
                    <>
                      <button
                        className={buttonGhost}
                        onClick={() => void cambiarEstado(current, current.status === 'bot_active' ? 'pause' : 'resume')}
                      >
                        {current.status === 'bot_active' ? 'Pausar bot' : 'Reactivar bot'}
                      </button>
                      <button className={buttonGhost} onClick={() => void cambiarEstado(current, 'close')}>
                        Marcar resuelta
                      </button>
                    </>
                  )}
                </span>
              </header>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === 'in' ? 'bg-slate-100' : m.sender_type === 'bot' ? 'bg-violet-100' : 'bg-sky-100'
                      }`}
                    >
                      <p className="whitespace-pre-line">{m.body}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {SENDER_LABEL[m.sender_type ?? ''] ?? m.sender_type} · {dt(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-center text-sm text-slate-400">Sin mensajes todavía.</p>}
              </div>
              <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => void send(e)}>
                <input
                  className={inputClass}
                  placeholder="Escribí tu respuesta al cliente…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button variant="primary" type="submit" loading={enviando} disabled={!draft.trim()}>
                  Enviar
                </Button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-slate-400">
              <p className="font-medium text-slate-500">Elegí una conversación de la lista</p>
              <p className="text-xs">A la derecha vas a ver quién es el cliente y qué tiene agendado.</p>
            </div>
          )}
        </section>

        {current ? (
          <div className="hidden min-h-0 lg:flex lg:flex-col">
            <PanelCliente conversation={current} onLinked={loadConversations} />
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}
      </div>
    </div>
  );
}
