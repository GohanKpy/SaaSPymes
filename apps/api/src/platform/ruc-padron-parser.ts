// Parser del listado de RUC de la DNIT (ADR 0012). Cada archivo rucN.txt trae
// una linea por contribuyente, separada por '|' y con un separador final:
//   1000000|CAÑETE GONZALEZ, JUANA DEL CARMEN|3|CAGJ761720E|ACTIVO|
//   ruc     razon social                      dv ruc anterior estado
// El RUC no siempre es numerico (hay claves con letra final: 1023860A).

export interface PadronRow {
  ruc: string;
  dv: string;
  razonSocial: string;
  rucAnterior: string | null;
  estado: string;
}

export interface PadronParse {
  rows: PadronRow[];
  /** Lineas ignoradas (vacias o sin RUC/DV utilizable). */
  skipped: number;
}

const espacios = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Parsea un archivo completo. Si un RUC se repite dentro del archivo gana la ultima linea. */
export function parsearPadron(text: string): PadronParse {
  const porRuc = new Map<string, PadronRow>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parts = raw.split('|');
    const ruc = (parts[0] ?? '').trim().toUpperCase();
    const razonSocial = espacios(parts[1] ?? '');
    const dv = (parts[2] ?? '').trim();
    const rucAnterior = espacios(parts[3] ?? '');
    const estado = espacios(parts[4] ?? '').toUpperCase();
    if (!/^[0-9A-Z]{1,16}$/.test(ruc) || !/^\d$/.test(dv) || !razonSocial) {
      skipped++;
      continue;
    }
    porRuc.set(ruc, {
      ruc,
      dv,
      razonSocial,
      rucAnterior: rucAnterior || null,
      estado: estado || 'DESCONOCIDO',
    });
  }
  return { rows: [...porRuc.values()], skipped };
}

/**
 * Enlaces ruc0..ruc9.zip dentro del HTML de la pagina de la DNIT. Los ids de
 * documento cambian con cada publicacion, por eso se leen de la pagina y no
 * se fijan en codigo. Devuelve un mapa digito -> URL absoluta.
 */
export function enlacesDelPadron(html: string, pageUrl: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /href="([^"]*\/ruc(\d)\.zip[^"]*)"/gi;
  for (const m of html.matchAll(re)) {
    const href = (m[1] ?? '').replace(/&amp;/g, '&');
    const digit = Number(m[2]);
    if (out.has(digit)) continue;
    try {
      out.set(digit, new URL(href, pageUrl).toString());
    } catch {
      // enlace malformado: se ignora
    }
  }
  return out;
}
