'use client';

import { useEffect, useRef, useState } from 'react';

import { api } from '../../lib/api';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'padmin_asistente';
const BIENVENIDA =
  'Hola! Soy el asistente del equipo de soporte. Preguntame lo que necesites sobre el sistema: como se hace algo, que significa un error y como resolverlo, o como guiar a un cliente paso a paso.';

/**
 * Asistente interno del portal admin (pedido 2026-09-02): burbuja de chat
 * arriba a la derecha, siempre visible. Responde desde el manual del sistema
 * con el mismo motor de IA del bot, para que los agentes de soporte resuelvan
 * dudas sin depender del dueño de la plataforma. El historial vive en
 * sessionStorage (sobrevive a la navegacion, muere al cerrar la pestaña).
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved) as Msg[]);
    } catch {
      // storage bloqueado o corrupto: se arranca vacio
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
    } catch {
      // sin storage no pasa nada: el chat sigue en memoria
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ reply: string }>('/platform/assistant', {
        method: 'POST',
        json: { messages: next.slice(-20) },
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Burbuja fija arriba a la derecha, sobre todo el portal */}
      <button
        onClick={() => setOpen(!open)}
        title="Asistente del sistema"
        aria-label="Asistente del sistema"
        className="fixed right-4 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-violet-700"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          // Robot: cabeza con antena y dos ojos
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4.5" y="8" width="15" height="11" rx="2.5" />
            <path strokeLinecap="round" d="M12 8V5M12 5a1.3 1.3 0 1 0 0-2.6A1.3 1.3 0 0 0 12 5Z" />
            <circle cx="9.2" cy="12.6" r="1" fill="currentColor" stroke="none" />
            <circle cx="14.8" cy="12.6" r="1" fill="currentColor" stroke="none" />
            <path strokeLinecap="round" d="M9.5 16h5" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed bottom-4 right-4 top-16 z-50 flex w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-100 bg-violet-600 px-4 py-2.5 text-white">
            <div>
              <p className="text-sm font-semibold">Asistente del sistema</p>
              <p className="text-[11px] text-violet-200">
                Responde desde el manual oficial: uso, errores y soluciones
              </p>
            </div>
            <button
              className="text-xs text-violet-200 hover:text-white hover:underline"
              onClick={() => {
                setMessages([]);
                setError(null);
                try {
                  sessionStorage.removeItem(STORAGE_KEY);
                } catch {
                  // sin storage, igual se limpio el estado
                }
              }}
            >
              Limpiar chat
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            <div className="max-w-[85%] rounded-lg bg-violet-50 px-3 py-2 text-sm text-slate-700">
              {BIENVENIDA}
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-sky-100 text-slate-800' : 'bg-violet-50 text-slate-700'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="max-w-[85%] rounded-lg bg-violet-50 px-3 py-2 text-sm text-slate-400">
                Pensando…
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
            )}
          </div>

          <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={(e) => void send(e)}>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
              placeholder="Ej: que significa el error…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <button
              className="shrink-0 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              disabled={busy || !draft.trim()}
            >
              Enviar
            </button>
          </form>
        </div>
      )}
    </>
  );
}
