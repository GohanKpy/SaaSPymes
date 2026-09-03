// Barandas de formato a la salida del bot (ADR 0011): lo que el prompt pide
// y el modelo ignora, se garantiza aca.
import { describe, expect, it } from 'vitest';

import { aTextoPlano } from '../src/common/texto-plano';

describe('aTextoPlano', () => {
  it('quita negritas, subrayados y encabezados de Markdown', () => {
    expect(aTextoPlano('Tu turno para el **corte de caballero** el __viernes__.')).toBe(
      'Tu turno para el corte de caballero el viernes.',
    );
    expect(aTextoPlano('## Horarios\n* 08:00\n• 09:00')).toBe('Horarios\n- 08:00\n- 09:00');
  });

  it('dos horarios sueltos en una linea salen uno por linea (se leia como rango)', () => {
    expect(aTextoPlano('Marco tiene libre:\n- 08:00 - 12:00\nTe sirve alguno?')).toBe(
      'Marco tiene libre:\n- 08:00\n- 12:00\nTe sirve alguno?',
    );
    expect(aTextoPlano('08:00 · 08:30 · 09:00')).toBe('- 08:00\n- 08:30\n- 09:00');
  });

  it('un rango real escrito con "a" y las frases con una sola hora se respetan', () => {
    expect(aTextoPlano('Atendemos de 08:00 a 12:00.')).toBe('Atendemos de 08:00 a 12:00.');
    expect(aTextoPlano('Quedo confirmado a las 14:30.')).toBe('Quedo confirmado a las 14:30.');
  });
});
