// Llaves del motor del bot (2026-09-24): el navegador guardo la contrasena del
// panel como llave de OpenAI y el bot quedo sin IA sin que nadie lo notara.
import { describe, expect, it } from 'vitest';

import { botEngineSettingsPut } from '../dtos/platform-settings';

const put = (extra: Record<string, unknown>) => botEngineSettingsPut.safeParse({ provider: 'openai', ...extra });
const relleno = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';

describe('formato de las llaves de IA', () => {
  it.each([`sk-${relleno}`, `sk-proj-${relleno}_x-Y`, `sk-svcacct-${relleno}`])('acepta la llave de OpenAI %s', (llave) => {
    expect(put({ openai_api_key: llave }).success).toBe(true);
  });

  it('recorta espacios al pegar', () => {
    const r = put({ openai_api_key: `  sk-${relleno}\n` });
    expect(r.success && r.data.openai_api_key).toBe(`sk-${relleno}`);
  });

  it.each([
    ['una contrasena del panel', 'MiClaveDelPanel-2026-abcdefghij'],
    ['una llave cortada', 'sk-abc'],
    ['una llave de Anthropic', `sk-ant-api03-${relleno}`],
    ['una llave con espacios adentro', `sk-${relleno} ${relleno}`],
  ])('rechaza como llave de OpenAI %s', (_caso, llave) => {
    const r = put({ openai_api_key: llave });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['openai_api_key']);
  });

  it('acepta la llave de Anthropic y rechaza una de OpenAI en su lugar', () => {
    expect(put({ anthropic_api_key: `sk-ant-api03-${relleno}` }).success).toBe(true);
    expect(put({ anthropic_api_key: `sk-${relleno}` }).success).toBe(false);
  });

  it('sin llaves sigue valido (vacio = mantener la cargada)', () => {
    expect(put({ reply_debounce_seconds: 15 }).success).toBe(true);
  });
});
