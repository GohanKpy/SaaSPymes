'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, sseUrl } from '../../../lib/api';
import { ErrorNote, buttonClass, buttonGhost, dt, inputClass } from '../../../lib/ui';

interface Conversation {
  id: string;
  phoneE164: string;
  status: string;
  lastMessageAt: string | null;
  customer: { firstName: string; lastName: string | null } | null;
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
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      <h1 className="text-xl font-semibold">Bandeja de chat</h1>
      <ErrorNote error={error} />
      <div className="grid min-h-[60vh] grid-cols-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <aside className="border-r border-slate-100">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelected(c.id);
                loadMessages(c.id);
              }}
              className={`block w-full border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-50 ${selected === c.id ? 'bg-sky-50' : ''}`}
            >
              <p className="font-medium">
                {c.customer ? `${c.customer.firstName} ${c.customer.lastName ?? ''}` : c.phoneE164}
              </p>
              <p className="text-xs text-slate-500">
                {c.phoneE164} · {c.status === 'bot_active' ? 'bot activo' : c.status} · {dt(c.lastMessageAt)}
              </p>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-slate-400">
              Sin conversaciones. Proba el chat de prueba en /chat.
            </p>
          )}
        </aside>

        <section className="col-span-2 flex flex-col">
          {current ? (
            <>
              <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm">
                <span>
                  {current.customer
                    ? `${current.customer.firstName} ${current.customer.lastName ?? ''}`
                    : current.phoneE164}
                </span>
                <button className={buttonGhost} onClick={() => void toggleBot(current)}>
                  {current.status === 'bot_active' ? 'Pausar bot' : 'Reactivar bot'}
                </button>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
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
                      <p>{m.body}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {m.sender_type} · {dt(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
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
