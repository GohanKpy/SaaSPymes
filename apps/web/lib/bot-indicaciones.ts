/**
 * Avisos sobre las indicaciones del negocio para el bot (ADR 0011). El bot
 * toma horarios, precios, servicios y datos del cliente del sistema; si el
 * negocio los repite acá, el modelo recibe dos versiones y se confunde (caso
 * real 2026-09-02: "Horario: 11 AM a 9 PM" contra los horarios de Agenda).
 * No bloquea el guardado: avisa en vivo para que el dueño decida.
 */
const REGLAS: { patron: RegExp; aviso: string }[] = [
  {
    patron: /\b\d{1,2}\s*(am|pm|hs\b|h\b)|\b\d{1,2}:\d{2}\b|\bhorarios?\b/i,
    aviso: 'Horarios: el bot los toma de Agenda → Horarios de atención. Si acá dice otra cosa, el bot se confunde.',
  },
  {
    patron: /\b(gs\.?|guaran[ií]es|precios?|tarifas?)\b|\d{1,3}\.\d{3}\b/i,
    aviso: 'Precios: el bot los consulta del Catálogo en vivo. No hace falta escribirlos.',
  },
  {
    patron: /servicios?\s*(principales|que ofrecemos|:)|ofrecemos\s*:/i,
    aviso: 'Lista de servicios: el bot usa el Catálogo real. Una lista distinta acá lo lleva a ofrecer cosas que no existen.',
  },
  {
    patron:
      /(nombre|tel[eé]fono|celular|correo|email)[^.\n]{0,50}(obligatori|necesari|requer|solicit|pedi)|(solicit|pedi|requer)[^.\n]{0,60}(nombre|tel[eé]fono|celular)/i,
    aviso: 'Pedir nombre o teléfono como requisito: el registro es opcional, el sistema identifica al cliente por su número. Si lo exigís acá, el bot traba las reservas.',
  },
  {
    patron: /\[[A-ZÁÉÍÓÚÑ_ ]{3,}\]/,
    aviso: 'Hay marcadores sin completar (por ejemplo [TELEFONO]). Completalos o borralos.',
  },
  {
    patron: /verificar[ée]|voy a verificar|indica que verificar|te confirmo m[aá]s tarde/i,
    aviso: '"Verificaré la información": el bot no puede prometer cosas para después. Lo que no sabe, lo deriva a una persona del equipo.',
  },
  {
    patron: /formas? de pago|medios? de pago/i,
    aviso: 'Formas de pago: el sistema no tiene ese dato. Si lo mencionás, escribí cuáles son; si no, el bot inventa.',
  },
];

export function avisosDeIndicaciones(texto: string): string[] {
  const t = texto.trim();
  if (!t) return [];
  return REGLAS.filter((r) => r.patron.test(t)).map((r) => r.aviso);
}
