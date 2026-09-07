'use client';

import type { InputHTMLAttributes } from 'react';

import { inputClass } from './ui';

/** "150000" → "150.000" (separador de miles paraguayo). Solo digitos. */
export function formatearMiles(raw: string | number): string {
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "150.000" → "150000". */
export function soloDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Campo de monto en guaranies (pedido de Johan 2026-09-07): se tipea 150000 y
 * se ve 150.000 mientras se escribe. `value` y `onChange` trabajan con el
 * texto que muestra el campo; el servidor acepta el formato con puntos
 * (montoGs), asi que viaja tal cual.
 */
export function MoneyInput({
  value,
  onChange,
  className = '',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={`${inputClass} text-right tabular-nums ${className}`}
      value={formatearMiles(value)}
      onChange={(e) => onChange(formatearMiles(e.target.value))}
    />
  );
}
