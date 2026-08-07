'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_URL } from '../../lib/api';
import { Field, buttonClass, inputClass } from '../../lib/ui';

interface ChatMessage {
  id: string;
  direction: string;
  sender_type: string;
  body: string;
  created_at: string;
}

// Chat web de prueba: el lado del CLIENTE FINAL. Envia mensajes por el
// pipeline real de webhooks (firmados) y muestra las respuestas del panel
// o del bot. Cuando WhatsApp este conectado, este mismo flujo corre con
// mensajes reales de Meta.
export default function WebchatTester() {
  const [config, setConfig] = useState({ phone_number_id: 'dev-tucano-001', from_phone: '+595971234567', from_name: 'Cliente de prueba' });
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Solo "pegamos" el scroll al fondo si el usuario YA estaba abajo: si
  // subio a releer, el poll de cada 2 s no debe arrastrarlo de vuelta.
  const stickToBottom = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/v1/webhooks/webchat/messages?phone_number_id=${encodeURIComponent(config.phone_number_id)}&from_phone=${encodeURIComponent(config.from_phone)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { status: string | null; messages: ChatMessage[] };
      // Evita re-render (y por lo tanto scroll) si no hay mensajes nuevos.
      setMessages((prev) => {
        const last = data.messages[data.messages.length - 1];
        const prevLast = prev[prev.length - 1];
        return prev.length === data.messages.length && last?.id === prevLast?.id
          ? prev
          : data.messages;
      });
      setStatus(data.status);
    } catch {
      /* la API puede no estar levantada */
    }
  }, [config.phone_number_id, config.from_phone]);

  useEffect(() => {
    if (!started) return;
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => clearInterval(timer);
  }, [started, poll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setError(null);
    const res = await fetch('/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...config, body: draft }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; title?: string };
      setError(data.error ?? data.title ?? `Error ${res.status}: el phone_number_id esta configurado en Ajustes?`);
      return;
    }
    setDraft('');
    stickToBottom.current = true; // tu propio mensaje siempre te lleva al final
    setTimeout(() => void poll(), 400);
  }

  return (
    <main className="mx-auto flex h-screen max-w-lg flex-col overflow-hidden p-4">
      <h1 className="mb-1 text-lg font-semibold">Chat de prueba (cliente final)</h1>
      <p className="mb-4 text-xs text-slate-500">
        Simula a un cliente escribiendo por WhatsApp: los mensajes entran firmados por el webhook
        real. Miralos llegar en la bandeja del panel; las respuestas (del personal o del bot)
        aparecen aca.
      </p>

      {!started ? (
        <form
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStarted(true);
          }}
        >
          <Field label="phone_number_id del negocio (Ajustes → WhatsApp)">
            <input className={inputClass} value={config.phone_number_id} onChange={(e) => setConfig({ ...config, phone_number_id: e.target.value })} required />
          </Field>
          <Field label="Tu numero (como cliente)">
            <input className={inputClass} value={config.from_phone} onChange={(e) => setConfig({ ...config, from_phone: e.target.value })} required />
          </Field>
          <Field label="Tu nombre">
            <input className={inputClass} value={config.from_name} onChange={(e) => setConfig({ ...config, from_name: e.target.value })} />
          </Field>
          <button className={`${buttonClass} w-full`}>Empezar a chatear</button>
        </form>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
            {config.from_name} → negocio {config.phone_number_id}
            {status ? ` · conversacion: ${status === 'bot_active' ? 'bot activo' : status}` : ''}
          </header>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4"
          >
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                  <p className="whitespace-pre-line">{m.body}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {m.direction === 'in' ? 'vos' : m.sender_type === 'bot' ? 'bot' : 'negocio'}
                  </p>
                </div>
              </div>
            ))}
            {messages.length === 0 && <p className="text-center text-sm text-slate-400">Escribi tu primer mensaje</p>}
          </div>
          {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}
          <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => void send(e)}>
            <input className={inputClass} placeholder="Escribi como cliente…" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className={buttonClass}>Enviar</button>
          </form>
        </div>
      )}
    </main>
  );
}
