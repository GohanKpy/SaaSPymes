'use client';

import { useState } from 'react';

import { Button } from './ui';

/**
 * Credenciales de un solo uso (alta de usuario, contraseña reiniciada): se
 * muestran una vez, con boton Copiar. Fase 3 de la auditoria de paneles
 * 2026-09-05: antes habia que seleccionar el texto a mano.
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
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" role="status">
      <p className="font-medium text-amber-900">{title}</p>
      <p className="mt-0.5 text-xs text-amber-800">Se muestran UNA sola vez: copialas y pasáselas por un canal seguro.</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono">
        <span>
          <span className="text-xs text-amber-800">Usuario:</span> {email}
        </span>
        <span>
          <span className="text-xs text-amber-800">Contraseña:</span> {password}
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(`Usuario: ${email}\nContraseña: ${password}`)
              .then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              })
              .catch(() => undefined);
          }}
        >
          {copiado ? '✓ Copiado' : 'Copiar'}
        </Button>
      </div>
      <button type="button" className="mt-2 text-amber-700 underline" onClick={onHide}>
        Ya las guardé, ocultar
      </button>
    </div>
  );
}
