/**
 * Ocultamiento de datos sensibles para el registro de acciones (auditoria
 * de seguridad, 2026-09-07). Las contraseñas, tokens, secretos y codigos de
 * un solo uso JAMAS se guardan: la clave queda, el valor se reemplaza por
 * "[oculto]". Los textos largos (fotos en base64, logos) se resumen.
 */
const SENSIBLE = /(pass|password|contrase|token|secret|api_key|apikey|authorization|otp|totp|cookie|client_secret|verify)/i;
const MAX_TEXTO = 300;
const MAX_JSON = 6000;
const MAX_PROFUNDIDAD = 6;

export function redactar(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return valor;
  if (profundidad > MAX_PROFUNDIDAD) return '[…]';
  if (typeof valor === 'string') return valor.length > MAX_TEXTO ? `[texto de ${valor.length} caracteres]` : valor;
  if (typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => redactar(v, profundidad + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    out[k] = SENSIBLE.test(k) ? (v === undefined || v === null || v === '' ? v : '[oculto]') : redactar(v, profundidad + 1);
  }
  return out;
}

/** Cuerpo del pedido listo para guardar: redactado y con tope de tamaño. */
export function cuerpoParaAuditoria(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  const limpio = redactar(body);
  try {
    const texto = JSON.stringify(limpio);
    if (texto.length <= MAX_JSON) return limpio;
    return { _truncado: true, _tamano: texto.length, _claves: typeof limpio === 'object' && limpio ? Object.keys(limpio as object).slice(0, 40) : [] };
  } catch {
    return { _no_serializable: true };
  }
}
