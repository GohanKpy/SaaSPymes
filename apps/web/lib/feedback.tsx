'use client';

// Dialogos y avisos del sistema (auditoria de paneles 2026-09-05, fase 0).
// Reemplazan a window.confirm / window.prompt (que no se pueden estilar, no
// explican consecuencias y en algunos navegadores se bloquean) y dan lo que
// no existia: un aviso de exito junto a la accion. Un solo proveedor por
// portal: se monta en el layout y las pantallas usan los hooks.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button, Modal, inputClass } from './ui';

export interface ConfirmOptions {
  title: string;
  /** La consecuencia en una frase: que pasa si sigue adelante. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = boton rojo (borrar, cancelar turnos, anular); primary = accion importante no destructiva. */
  tone?: 'danger' | 'primary';
}

export interface AskTextOptions {
  title: string;
  message?: ReactNode;
  label: string;
  placeholder?: string;
  /** Minimo de caracteres para habilitar el boton (default 3 si required). */
  required?: boolean;
  confirmLabel?: string;
  multiline?: boolean;
  initialValue?: string;
}

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'ask'; opts: AskTextOptions; resolve: (value: string | null) => void };

interface FeedbackApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  askText: (opts: AskTextOptions) => Promise<string | null>;
  toast: {
    success: (text: string) => void;
    error: (text: string) => void;
    info: (text: string) => void;
  };
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-2), { id, kind, text }]);
    // Los errores duran mas: hay que poder leerlos.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({
      confirm: (opts) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })),
      askText: (opts) => new Promise<string | null>((resolve) => setPending({ kind: 'ask', opts, resolve })),
      toast: {
        success: (text) => push('success', text),
        error: (text) => push('error', text),
        info: (text) => push('info', text),
      },
    }),
    [push],
  );

  const close = () => setPending(null);

  return (
    <Ctx.Provider value={api}>
      {children}

      {pending?.kind === 'confirm' && (
        <ConfirmDialog
          opts={pending.opts}
          onResult={(ok) => {
            pending.resolve(ok);
            close();
          }}
        />
      )}
      {pending?.kind === 'ask' && (
        <AskTextDialog
          opts={pending.opts}
          onResult={(value) => {
            pending.resolve(value);
            close();
          }}
        />
      )}

      {/* Avisos: abajo a la derecha en escritorio, centrados en el celular */}
      {toasts.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className={`pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-left text-sm shadow-lg ring-1 ${
                t.kind === 'success'
                  ? 'bg-emerald-600 text-white ring-emerald-700'
                  : t.kind === 'error'
                    ? 'bg-red-600 text-white ring-red-700'
                    : 'bg-slate-800 text-white ring-slate-900'
              }`}
            >
              {t.kind === 'success' ? '✓ ' : t.kind === 'error' ? '✕ ' : ''}
              {t.text}
            </button>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

function useFeedback(): FeedbackApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('FeedbackProvider no esta montado en este portal');
  return ctx;
}

/** `const confirmar = useConfirm(); if (!(await confirmar({...}))) return;` */
export function useConfirm() {
  return useFeedback().confirm;
}

/** Pide un texto corto (motivo, nota) en un dialogo propio; null si cancela. */
export function useAskText() {
  return useFeedback().askText;
}

/** `toast.success('Turno agendado')` — visible desde cualquier punto de la pantalla. */
export function useToast() {
  return useFeedback().toast;
}

function ConfirmDialog({ opts, onResult }: { opts: ConfirmOptions; onResult: (ok: boolean) => void }) {
  const tone = opts.tone ?? 'danger';
  return (
    <Modal title={opts.title} onClose={() => onResult(false)} size="sm" role="alertdialog">
      {opts.message && <p className="text-sm text-slate-600">{opts.message}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onResult(false)}>
          {opts.cancelLabel ?? 'Volver'}
        </Button>
        <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={() => onResult(true)} autoFocus>
          {opts.confirmLabel ?? 'Confirmar'}
        </Button>
      </div>
    </Modal>
  );
}

function AskTextDialog({ opts, onResult }: { opts: AskTextOptions; onResult: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.initialValue ?? '');
  const required = opts.required ?? true;
  const valido = !required || value.trim().length >= 3;
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <Modal title={opts.title} onClose={() => onResult(null)} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) onResult(value.trim());
        }}
      >
        {opts.message && <p className="mb-3 text-sm text-slate-600">{opts.message}</p>}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{opts.label}</span>
          {opts.multiline ? (
            <textarea
              ref={ref as React.RefObject<HTMLTextAreaElement>}
              className={`${inputClass} h-24`}
              value={value}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              ref={ref as React.RefObject<HTMLInputElement>}
              className={inputClass}
              value={value}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </label>
        {required && !valido && value.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">Escribí al menos 3 caracteres.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={() => onResult(null)}>
            Volver
          </Button>
          <Button variant="primary" type="submit" disabled={!valido}>
            {opts.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
