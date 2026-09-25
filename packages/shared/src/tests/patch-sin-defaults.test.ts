// Regresion 2026-09-24: en zod 4 `.partial()` conserva los `.default()` del
// alta, y un PATCH con un solo campo pisaba el resto con los valores por
// defecto (servicio pausado que se reactivaba, plan archivado que volvia,
// plan que perdia todas sus features). Todo esquema de edicion (*Update /
// *Patch) debe devolver solo lo que vino en el body.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as dtos from '../index';

const edicion = (Object.entries(dtos) as [string, unknown][]).filter(
  (e): e is [string, z.ZodObject] => /(Update|Patch)$/.test(e[0]) && e[1] instanceof z.ZodObject,
);

describe('PATCH sin defaults del alta', () => {
  it('hay esquemas de edicion para revisar', () => {
    expect(edicion.length).toBeGreaterThanOrEqual(20);
  });

  it.each(edicion)('%s no tiene campos con default', (_nombre, schema) => {
    const conDefault = Object.entries(schema.shape)
      .filter(([, s]) => s instanceof z.ZodDefault || (s instanceof z.ZodOptional && s.unwrap() instanceof z.ZodDefault))
      .map(([campo]) => campo);
    expect(conDefault).toEqual([]);
  });

  it.each(edicion)('%s con body vacio no inventa campos', (_nombre, schema) => {
    const r = schema.safeParse({});
    // Algunos PATCH exigen un campo por diseno; los que aceptan {} deben quedar en {}.
    if (r.success) expect(r.data).toEqual({});
  });

  it.each([
    ['serviceUpdate', dtos.serviceUpdate, { price: '150.000' }, { price: 150000n }],
    ['categoryUpdate', dtos.categoryUpdate, { name: 'Cortes' }, { name: 'Cortes' }],
    ['employeeUpdate', dtos.employeeUpdate, { schedule: null }, { schedule: null }],
    ['planUpdate', dtos.planUpdate, { name: 'Pro' }, { name: 'Pro' }],
    ['contactPointUpdate', dtos.contactPointUpdate, { value: 'x@y.com' }, { value: 'x@y.com' }],
    ['fiscalIdUpdate', dtos.fiscalIdUpdate, { legal_name: 'ACME SA' }, { legal_name: 'ACME SA' }],
  ] as const)('%s devuelve solo lo enviado', (_nombre, schema, body, esperado) => {
    expect((schema as z.ZodType).parse(body)).toEqual(esperado);
  });

  it('el alta conserva sus defaults', () => {
    const s = dtos.serviceCreate.parse({ category_id: '00000000-0000-4000-8000-000000000000', name: 'Corte', price: '1000' });
    expect(s).toMatchObject({ currency: 'PYG', tax_rate: 10, is_active: true });
    expect(dtos.planCreate.parse({ code: 'p', name: 'P', monthly_price: '0' }).feature_codes).toEqual([]);
  });

  it('el PATCH sigue siendo estricto y valida los tipos', () => {
    expect(dtos.serviceUpdate.safeParse({ tax_rate: 7 }).success).toBe(false);
    expect(dtos.serviceUpdate.safeParse({ campo_raro: 1 }).success).toBe(false);
    expect(dtos.employeeUpdate.parse({ is_active: false, on_conflict: 'keep' })).toEqual({ is_active: false, on_conflict: 'keep' });
  });
});
