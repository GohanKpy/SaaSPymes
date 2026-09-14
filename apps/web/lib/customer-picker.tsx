'use client';

// Buscador de clientes compartido (fase 0, 2026-09-05). Reemplaza los
// <select> que traian los primeros 50 clientes en Agenda y Facturacion (el
// cliente 51 no se podia agendar ni facturar). Busca en el servidor mientras
// se escribe y permite crear un cliente nuevo sin salir del formulario.
import { useEffect, useRef, useState } from 'react';

import { api } from './api';
import { errorMessage } from './labels';
import { dvRuc, formatRucConDv } from './ruc';
import { Button, inputClass } from './ui';

export interface PickedCustomer {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  email?: string | null;
  docNumber?: string | null;
}

export function customerName(c: { firstName: string; lastName: string | null }): string {
  return `${c.firstName} ${c.lastName ?? ''}`.trim();
}

const NUEVO_VACIO = { first_name: '', last_name: '', phone_e164: '', email: '', doc_number: '', legal_name: '' };

export function CustomerPicker({
  value,
  onChange,
  autoFocus = false,
  allowCreate = true,
  placeholder = 'Buscar por nombre, celular o documento…',
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  autoFocus?: boolean;
  allowCreate?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nuevo, setNuevo] = useState(NUEVO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Busqueda con espera corta: una consulta por pausa, no por tecla.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    const t = setTimeout(() => {
      setBusy(true);
      api<{ data: PickedCustomer[] }>(`/customers?limit=8${term ? `&q=${encodeURIComponent(term)}` : ''}`)
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Sin <form> propio: el selector vive ADENTRO del formulario de Nuevo turno
  // o de la factura y un form anidado no es HTML valido — el navegador
  // mandaba el formulario exterior por GET, la pagina se recargaba y el
  // cliente nunca se guardaba (reporte de Johan 2026-09-08).
  async function crear() {
    if (busy) return;
    setError(null);
    if (!nuevo.first_name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setBusy(true);
    const ruc = nuevo.doc_number.trim().split('-')[0] ?? '';
    try {
      const created = await api<PickedCustomer>('/customers', {
        method: 'POST',
        json: {
          first_name: nuevo.first_name.trim(),
          ...(nuevo.last_name.trim() ? { last_name: nuevo.last_name.trim() } : {}),
          ...(nuevo.phone_e164.trim() ? { phone_e164: nuevo.phone_e164.trim() } : {}),
          ...(nuevo.email.trim() ? { email: nuevo.email.trim() } : {}),
          // Datos de facturacion desde el alta (2026-09-08), opcionales.
          ...(ruc ? { doc_type: 'ruc', doc_number: ruc, ruc_dv: dvRuc(ruc) ?? undefined } : {}),
          ...(ruc && nuevo.legal_name.trim() ? { legal_name: nuevo.legal_name.trim() } : {}),
        },
      });
      onChange(created);
      setCreating(false);
      setOpen(false);
      setNuevo(NUEVO_VACIO);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const dupId = (err as { problem?: { detail?: string } }).problem?.detail;
      if (status === 409 && dupId) {
        // Ya existe: se usa el que esta, no se duplica.
        try {
          const existing = await api<PickedCustomer>(`/customers/${dupId}`);
          onChange(existing);
          setCreating(false);
          setOpen(false);
          return;
        } catch {
          /* cae al mensaje generico */
        }
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const enterCrea = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void crear();
    }
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="truncate">
          <span className="font-medium text-slate-900">{customerName(value)}</span>
          {value.phoneE164 && <span className="ml-2 text-slate-500">{value.phoneE164}</span>}
        </span>
        <button
          type="button"
          className="shrink-0 text-xs text-sky-700 hover:underline"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        className={inputClass}
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCreating(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const first = results[0];
          if (first) {
            onChange(first);
            setOpen(false);
            setQ('');
          }
        }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {!creating && (
            <ul className="max-h-60 overflow-y-auto text-sm">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sky-50"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="truncate">{customerName(c)}</span>
                    <span className="shrink-0 text-xs text-slate-500">{c.phoneE164 ?? c.docNumber ?? ''}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-2 text-slate-400">
                  {busy ? 'Buscando…' : q.trim() ? 'Ningún cliente coincide.' : 'Escribí para buscar.'}
                </li>
              )}
            </ul>
          )}
          {allowCreate && !creating && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-sky-700 hover:bg-sky-50"
              onClick={() => {
                setCreating(true);
                // Lo que ya escribio sirve como nombre.
                const partes = q.trim().split(/\s+/);
                setNuevo({
                  first_name: partes[0] ?? '',
                  last_name: partes.slice(1).join(' '),
                  phone_e164: /^\+?\d{6,}$/.test(q.trim()) ? q.trim() : '',
                  email: /^\S+@\S+\.\S+$/.test(q.trim()) ? q.trim() : '',
                  doc_number: '',
                  legal_name: '',
                });
              }}
            >
              + Crear cliente nuevo{q.trim() ? ` "${q.trim()}"` : ''}
            </button>
          )}
          {creating && (
            <div className="space-y-2 border-t border-slate-100 p-3" role="group" aria-label="Cliente nuevo">
              <p className="text-xs text-slate-500">Cliente nuevo: solo el nombre es obligatorio.</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputClass}
                  placeholder="Nombre *"
                  required
                  autoFocus
                  value={nuevo.first_name}
                  onChange={(e) => setNuevo({ ...nuevo, first_name: e.target.value })}
                  onKeyDown={enterCrea}
                />
                <input
                  className={inputClass}
                  placeholder="Apellido"
                  value={nuevo.last_name}
                  onChange={(e) => setNuevo({ ...nuevo, last_name: e.target.value })}
                  onKeyDown={enterCrea}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputClass}
                  placeholder="Celular (+595…)"
                  value={nuevo.phone_e164}
                  onChange={(e) => setNuevo({ ...nuevo, phone_e164: e.target.value })}
                  onKeyDown={enterCrea}
                />
                <input
                  className={inputClass}
                  type="email"
                  placeholder="Email"
                  value={nuevo.email}
                  onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
                  onKeyDown={enterCrea}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="RUC (opcional)"
                  title="Para facturar; el dígito verificador se completa solo"
                  value={nuevo.doc_number}
                  onChange={(e) => setNuevo({ ...nuevo, doc_number: e.target.value })}
                  onBlur={(e) => setNuevo({ ...nuevo, doc_number: formatRucConDv(e.target.value) })}
                  onKeyDown={enterCrea}
                />
                <input
                  className={inputClass}
                  placeholder="Razón social (opcional)"
                  disabled={!nuevo.doc_number.trim()}
                  value={nuevo.legal_name}
                  onChange={(e) => setNuevo({ ...nuevo, legal_name: e.target.value })}
                  onKeyDown={enterCrea}
                />
              </div>
              {error && <p className="text-xs text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  Volver
                </Button>
                <Button variant="primary" type="button" loading={busy} onClick={() => void crear()}>
                  Crear y elegir
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
