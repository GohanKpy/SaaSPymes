// Padron RUC de la DNIT (ADR 0012): parser del listado, lector de zip y
// descubrimiento de enlaces. Sin base ni red.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizarRuc } from '@pymes/shared';
import { describe, expect, it } from 'vitest';

import { unzipEntries } from '../src/common/unzip';
import { enlacesDelPadron, parsearPadron } from '../src/platform/ruc-padron-parser';

const fixture = () => readFileSync(fileURLToPath(new URL('./fixtures/padron-mini.zip', import.meta.url)));

describe('padron RUC', () => {
  it('lee el zip de la DNIT sin dependencias y parsea ruc|razon social|dv|anterior|estado|', () => {
    const entries = unzipEntries(fixture());
    expect(entries.map((e) => e.name)).toEqual(['ruc0.txt']);
    const { rows, skipped } = parsearPadron(entries[0]!.data.toString('utf8'));
    expect(skipped).toBe(1); // la linea 'MALO' sin DV
    expect(rows).toHaveLength(3);
    const juan = rows.find((r) => r.ruc === '2489073');
    expect(juan).toEqual({ ruc: '2489073', dv: '1', razonSocial: 'PEREZ GOMEZ, JUAN', rucAnterior: null, estado: 'SUSPENSION TEMPORAL' });
    // RUC con letra final: se conserva tal cual.
    expect(rows.find((r) => r.ruc === '1023860A')?.razonSocial).toBe('MONTIEL, JORGE');
  });

  it('un RUC repetido dentro del archivo se queda con la ultima linea (evita el doble ON CONFLICT)', () => {
    const entries = unzipEntries(fixture());
    const { rows } = parsearPadron(entries[0]!.data.toString('utf8'));
    expect(rows.filter((r) => r.ruc === '80089722')).toHaveLength(1);
    expect(rows.find((r) => r.ruc === '80089722')?.razonSocial).toBe('EMPRESA DE PRUEBA S.A. (RENOMBRADA)');
  });

  it('saca los 10 enlaces rucN.zip de la pagina de la DNIT, resueltos contra la pagina', () => {
    const html = Array.from({ length: 10 }, (_, d) => `<a href="/documents/20123/3434104/ruc${d}.zip/abc-${d}?t=1&amp;x=2">ruc${d}.zip</a>`).join('\n');
    const enlaces = enlacesDelPadron(html, 'https://www.dnit.gov.py/web/portal-institucional/listado-de-ruc-con-sus-equivalencias');
    expect(enlaces.size).toBe(10);
    expect(enlaces.get(7)).toBe('https://www.dnit.gov.py/documents/20123/3434104/ruc7.zip/abc-7?t=1&x=2');
  });

  it('normaliza lo que tipea el usuario a la clave del padron (sin DV, sin puntos)', () => {
    expect(normalizarRuc('80012345-6')).toBe('80012345');
    expect(normalizarRuc('80.012.345')).toBe('80012345');
    expect(normalizarRuc(' 1023860a ')).toBe('1023860A');
    expect(normalizarRuc('12')).toBe('');
    expect(normalizarRuc('')).toBe('');
  });
});

describe('calendario del padron (mensual, America/Asuncion, con recuperacion)', async () => {
  const { debeCorrer, proximaCita, ultimaCitaVencida } = await import('../src/platform/ruc-padron-schedule');
  const s = { dayOfMonth: 5, hour: 3 };
  // 5 de septiembre de 2026 a las 03:00 de Asuncion = 06:00Z (UTC-3).
  const cita = new Date('2026-09-05T06:00:00Z');

  it('sin padron cargado corre enseguida', () => {
    expect(debeCorrer(new Date('2026-09-20T12:00:00Z'), null, s, 0)).toBe(true);
    expect(debeCorrer(new Date('2026-09-20T12:00:00Z'), new Date('2026-09-19T00:00:00Z'), s, 0)).toBe(true);
  });

  it('corre en la cita y no antes; si el proceso estaba caido, corre al volver', () => {
    const ok = new Date('2026-08-05T06:10:00Z'); // corrida de agosto
    expect(ultimaCitaVencida(new Date('2026-09-05T05:59:00Z'), s).toISOString()).toBe('2026-08-05T06:00:00.000Z');
    expect(debeCorrer(new Date('2026-09-05T05:59:00Z'), ok, s, 2_000_000)).toBe(false);
    expect(debeCorrer(cita, ok, s, 2_000_000)).toBe(true);
    expect(debeCorrer(new Date('2026-09-11T15:00:00Z'), ok, s, 2_000_000)).toBe(true); // caido el dia 5
    expect(debeCorrer(new Date('2026-09-11T15:00:00Z'), new Date('2026-09-05T06:08:00Z'), s, 2_000_000)).toBe(false);
  });

  it('una descarga manual antes de la cita no la cancela', () => {
    const manual = new Date('2026-09-02T14:00:00Z');
    expect(debeCorrer(new Date('2026-09-03T14:00:00Z'), manual, s, 2_000_000)).toBe(false);
    expect(debeCorrer(cita, manual, s, 2_000_000)).toBe(true);
  });

  it('la proxima cita cruza el fin de año', () => {
    expect(proximaCita(new Date('2026-12-20T00:00:00Z'), s).toISOString()).toBe('2027-01-05T06:00:00.000Z');
    expect(proximaCita(new Date('2026-09-01T00:00:00Z'), s).toISOString()).toBe('2026-09-05T06:00:00.000Z');
  });
});
