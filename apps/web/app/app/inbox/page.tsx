'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';

import { api, sseUrl } from '../../../lib/api';
import { Badge, ErrorNote, PageHeader, buttonClass, buttonGhost, dt, inputClass } from '../../../lib/ui';

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}

/**
 * Ayuda para probar el bot sin WhatsApp real (pedido 2026-09-01): el dueño
 * ve aca el identificador de SU negocio (el que cargo en Ajustes → WhatsApp)
 * y entra al chat de prueba con ese dato ya puesto. Al conectar WhatsApp de
 * verdad (live), el panel deja de mostrar el simulador como via principal.
 */
function PanelDePrueba() {
  const [wa, setWa] = useState<Integration | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [abierto, setAbierto] = useState(true);

  useEffect(() => {
    void api<Integration[]>('/integrations')
      .then((rows) => setWa(rows.find((i) => i.type === 'whatsapp') ?? null))
      .catch(() => undefined);
  }, []);

  const id = typeof wa?.public_config.phone_number_id === 'string' ? wa.public_config.phone_number_id : '';
  const live = wa?.public_config.live === true;

  if (!wa?.configured || !id) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <b>Para probar tu bot falta un paso.</b> Anda a{' '}
        <Link className="font-medium underline" href="/app/settings">
          Ajustes → WhatsApp
        </Link>{' '}
        y carga el identificador de tu negocio (durante las pruebas puede ser cualquier nombre, por
        ejemplo <code className="rounded bg-white px-1">dev-mi-negocio</code>). Despues volve aca y
        vas a poder escribirle a tu bot como si fueras un cliente.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <b>Proba tu bot como si fueras un cliente.</b>{' '}
          {live
            ? 'Tu WhatsApp real ya esta conectado: escribile a tu numero desde tu celular y la conversacion aparece aca.'
            : 'Abri el chat de prueba y escribi: los mensajes entran a esta bandeja igual que los de WhatsApp.'}
        </div>
        <button className="shrink-0 text-xs text-sky-700 hover:underline" onClick={() => setAbierto(!abierto)}>
          {abierto ? 'ocultar' : 'ver como'}
        </button>
      </div>

      {abierto && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-sky-800">Identificador de tu negocio:</span>
            <code className="rounded-md border border-sky-200 bg-white px-2 py-1 font-mono text-sm font-medium">
              {id}
            </code>
            <button
              className={buttonGhost}
              onClick={() => {
                void navigator.clipboard.writeText(id).then(() => {
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 2000);
                });
              }}
            >
              {copiado ? '✓ copiado' : 'Copiar'}
            </button>
            <a className={buttonClass} href={`/chat?negocio=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
              Abrir chat de prueba
            </a>
          </div>
          <ol className="ml-4 list-decimal space-y-0.5 text-xs text-sky-900">
            <li>
              Toca <b>Abrir chat de prueba</b>: se abre en otra pestaña con tu identificador ya
              puesto (si lo abris a mano, pegalo en el campo &quot;phone_number_id del negocio&quot;).
            </li>
            <li>Poni un numero de celular cualquiera para hacer de cliente y escribi un mensaje.</li>
            <li>La conversacion aparece en esta bandeja y tu bot responde solo.</li>
          </ol>
        </div>
      )}
    </div>
  );
}

interface Conversation {
  id: string;
  phoneE164: string;
  status: string;
  needsHuman?: boolean;
  lastMessageAt: string | null;
  customer: {
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

const STATUS_LABEL: Record<string, string> = {
  bot_active: 'bot activo',
  paused: 'pausada',
  agent: 'con agente',
  inactive: 'inactiva',
  closed: 'cerrada',
};

const norm = (m: Message): Message => ({
  ...m,
  conversation_id: m.conversation_id ?? m.conversationId,
  sender_type: m.sender_type ?? m.senderType,
  created_at: m.created_at ?? m.createdAt,
});

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(() => {
    void api<{ data: Conversation[] }>('/conversations')
      .then((r) => setConversations(r.data))
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => loadConversations(), [loadConversations]);

  const loadMessages = useCallback((id: string) => {
    void api<{ data: Message[] }>(`/conversations/${id}/messages`)
      .then((r) => setMessages(r.data.map(norm)))
      .catch(() => undefined);
  }, []);

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

  // Scroll SOLO dentro del panel de mensajes: scrollIntoView escalaba a la
  // pagina entera y "bajaba" toda la vista al elegir un chat largo.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Filtro por cualquier dato del cliente o el telefono de la conversacion.
  const visible = conversations.filter((c) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      c.phoneE164,
      c.customer?.firstName,
      c.customer?.lastName,
      c.customer?.email,
      c.customer?.docNumber,
      c.customer?.phoneE164,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    try {
      await api(`/conversations/${selected}/messages`, { method: 'POST', json: { body: draft } });
      setDraft('');
      loadMessages(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function toggleBot(conv: Conversation) {
    const verb = conv.status === 'bot_active' ? 'pause' : 'resume';
    await api(`/conversations/${conv.id}/${verb}`, { method: 'POST', json: {} });
    loadConversations();
  }

  const current = conversations.find((c) => c.id === selected);

  return (
    <div className="space-y-3">
      <PageHeader title="Bandeja de chat" />
      <PanelDePrueba />
      <ErrorNote error={error} />
      <div className="grid h-[calc(100vh-330px)] min-h-[420px] grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <aside className="flex min-h-0 flex-col border-r border-slate-100">
          <div className="border-b border-slate-100 p-2">
            <input
              className={inputClass}
              placeholder="Buscar: nombre, telefono, email, doc…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  loadMessages(c.id);
                }}
                className={`block w-full border-b border-l-2 border-slate-50 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${selected === c.id ? 'border-l-sky-600 bg-sky-50' : 'border-l-transparent'}`}
              >
                <p className="font-medium">
                  {c.customer ? `${c.customer.firstName} ${c.customer.lastName ?? ''}` : c.phoneE164}
                  {c.needsHuman && (
                    <Badge tone="red" className="ml-2">
                      Necesita humano
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {c.phoneE164} · {STATUS_LABEL[c.status] ?? c.status} · {dt(c.lastMessageAt)}
                </p>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="p-4 text-sm text-slate-400">
                {conversations.length === 0
                  ? 'Sin conversaciones. Proba el chat de prueba en /chat.'
                  : 'Ninguna conversacion coincide con la busqueda.'}
              </p>
            )}
          </div>
        </aside>

        <section className="col-span-2 flex min-h-0 flex-col">
          {current ? (
            <>
              <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {current.customer
                      ? `${current.customer.firstName} ${current.customer.lastName ?? ''}`
                      : current.phoneE164}
                  </span>
                  <Badge tone={current.status === 'bot_active' ? 'violet' : 'slate'}>
                    {STATUS_LABEL[current.status] ?? current.status}
                  </Badge>
                  {current.needsHuman && <Badge tone="red">El bot no pudo responder: atender manualmente</Badge>}
                </span>
                <button className={buttonGhost} onClick={() => void toggleBot(current)}>
                  {current.status === 'bot_active' ? 'Pausar bot' : 'Reactivar bot'}
                </button>
              </header>
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === 'in'
                          ? 'bg-slate-100'
                          : m.sender_type === 'bot'
                            ? 'bg-violet-100'
                            : 'bg-sky-100'
                      }`}
                    >
                      <p className="whitespace-pre-line">{m.body}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {m.sender_type} · {dt(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => void send(e)}>
                <input
                  className={inputClass}
                  placeholder="Responder como agente…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className={buttonClass}>Enviar</button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Elegi una conversacion
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
