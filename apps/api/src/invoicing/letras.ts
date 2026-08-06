// Numero entero a letras en espanol, para el "TOTAL A PAGAR EN LETRAS"
// del KuDE (formato de factura paraguayo). Cubre hasta miles de millones,
// suficiente para montos en guaranies.

const UNIDADES = [
  '',
  'un',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciseis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
];

const DECENAS = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

const CENTENAS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

function hastaNoventaYNueve(n: number): string {
  if (n <= 20) return UNIDADES[n] ?? '';
  const decena = Math.floor(n / 10);
  const unidad = n % 10;
  if (decena === 2) return `veinti${UNIDADES[unidad]}`;
  return unidad === 0 ? (DECENAS[decena] ?? '') : `${DECENAS[decena]} y ${UNIDADES[unidad]}`;
}

function hastaNovecientos(n: number): string {
  if (n === 100) return 'cien';
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const cabeza = CENTENAS[centena] ?? '';
  if (resto === 0) return cabeza;
  return centena === 0 ? hastaNoventaYNueve(resto) : `${cabeza} ${hastaNoventaYNueve(resto)}`;
}

function grupoMiles(n: number): string {
  if (n < 1000) return hastaNovecientos(n);
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const cabeza = miles === 1 ? 'mil' : `${hastaNovecientos(miles)} mil`;
  return resto === 0 ? cabeza : `${cabeza} ${hastaNovecientos(resto)}`;
}

/** 12000 -> "DOCE MIL"; 1250500 -> "UN MILLON DOSCIENTOS CINCUENTA MIL QUINIENTOS". */
export function numeroALetras(value: bigint | number): string {
  let n = typeof value === 'bigint' ? Number(value) : Math.trunc(value);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'CERO';

  const partes: string[] = [];
  const milesDeMillones = Math.floor(n / 1_000_000_000);
  if (milesDeMillones > 0) {
    partes.push(
      milesDeMillones === 1 ? 'mil millones' : `${grupoMiles(milesDeMillones)} mil millones`,
    );
    n %= 1_000_000_000;
  }
  const millones = Math.floor(n / 1_000_000);
  if (millones > 0) {
    partes.push(millones === 1 ? 'un millon' : `${grupoMiles(millones)} millones`);
    n %= 1_000_000;
  }
  if (n > 0) partes.push(grupoMiles(n));

  const texto = partes.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
  // Apocope solo antes de sustantivo ("UN MILLON"); al final va "UNO"
  // porque en el KuDE la moneda antecede: "Guaranies MIL NOVENTA Y UNO".
  return texto.endsWith('UN') ? `${texto}O` : texto;
}
