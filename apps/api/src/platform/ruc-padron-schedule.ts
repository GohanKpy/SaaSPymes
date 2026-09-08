// Calendario del padron RUC (ADR 0012): corrida mensual a una hora local de
// Asuncion, con recuperacion. Funciones puras (sin reloj propio) para poder
// probarlas: el servicio les pasa `now` y la ultima corrida exitosa.

export const PADRON_TZ = 'America/Asuncion';

export interface PadronSchedule {
  /** 1-28: existe en todos los meses. */
  dayOfMonth: number;
  /** 0-23, hora local. */
  hour: number;
}

interface Partes {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PADRON_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function partesLocales(date: Date): Partes {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    min: Number(p.minute),
  };
}

/** Instante UTC de una hora de pared en Asuncion (sin suponer el offset: se deriva con Intl). */
function instanteLocal(y: number, m: number, d: number, h: number): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  const p = partesLocales(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(guess - (asUtc - guess));
}

/** Ultima cita programada que ya paso (este mes o el anterior). */
export function ultimaCitaVencida(now: Date, s: PadronSchedule): Date {
  const p = partesLocales(now);
  const esteMes = instanteLocal(p.y, p.m, s.dayOfMonth, s.hour);
  if (esteMes.getTime() <= now.getTime()) return esteMes;
  const [y, m] = p.m === 1 ? [p.y - 1, 12] : [p.y, p.m - 1];
  return instanteLocal(y, m, s.dayOfMonth, s.hour);
}

/** Primera cita programada estrictamente posterior a `now`. */
export function proximaCita(now: Date, s: PadronSchedule): Date {
  const p = partesLocales(now);
  const esteMes = instanteLocal(p.y, p.m, s.dayOfMonth, s.hour);
  if (esteMes.getTime() > now.getTime()) return esteMes;
  const [y, m] = p.m === 12 ? [p.y + 1, 1] : [p.y, p.m + 1];
  return instanteLocal(y, m, s.dayOfMonth, s.hour);
}

/**
 * Hay que correr si nunca se cargo el padron (primera carga inmediata) o si
 * la ultima corrida exitosa es anterior a la ultima cita que ya paso (cubre
 * el cron normal y el caso "el proceso estaba caido el dia 5").
 */
export function debeCorrer(
  now: Date,
  lastOk: Date | null,
  s: PadronSchedule,
  contribuyentes: number,
): boolean {
  if (contribuyentes === 0 || !lastOk) return true;
  return lastOk.getTime() < ultimaCitaVencida(now, s).getTime();
}

/** Cuando va a correr: ahora si esta pendiente, si no la proxima cita. */
export function proximaCorrida(
  now: Date,
  lastOk: Date | null,
  s: PadronSchedule,
  contribuyentes: number,
): Date {
  return debeCorrer(now, lastOk, s, contribuyentes) ? now : proximaCita(now, s);
}
