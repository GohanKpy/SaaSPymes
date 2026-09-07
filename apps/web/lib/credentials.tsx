'use client';

import { useRef, useState } from 'react';

import { copiarTexto, formatoCredenciales } from './clipboard';
import { useToast } from './feedback';
import { Button } from './ui';

/**
 * Credenciales de un solo uso (alta de usuario, contraseña reiniciada): se
 * muestran una vez, en una linea lista para pegar, con boton Copiar que
 * funciona tambien fuera de HTTPS y avisa si no pudo (2026-09-07).
 */
export function OneTimeCredentials({
  title,
  email,
  password,
  onHide,
}: {
  title: string;
  email: string;
  password: string;
  onHide: () => void;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const texto = formatoCredenciales(email, password);

  async function copiar() {
    const ok = await copiarTexto(texto);
    if (ok) {
      setCopiado(true);
      toast.success('Credenciales copiadas');
      setTimeout(() => setCopiado(false), 2000);
    } else {
      inputRef.current?.select();
      toast.error('No se pudo copiar automáticamente: el texto quedó seleccionado, copialo con Ctrl+C.');
    }
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" role="status">
      <p className="font-medium text-amber-900">{title}</p>
      <p className="mt-0.5 text-xs text-amber-800">Se muestran UNA sola vez: copialas y pasáselas por un canal seguro.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          value={texto}
          aria-label="Credenciales"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-[280px] flex-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-800"
        />
        <Button variant="ghost" onClick={() => void copiar()}>
          {copiado ? '✓ Copiado' : 'Copiar'}
        </Button>
      </div>
      <button type="button" className="mt-2 text-amber-700 underline" onClick={onHide}>
        Ya las guardé, ocultar
      </button>
    </div>
  );
}
