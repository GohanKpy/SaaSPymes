// Chequeo de IP contra lista de IPs/CIDRs IPv4 (ADR 0004).
// Lista vacia o ausente = sin restriccion (laboratorio).

function ipv4ToInt(ip: string): number | null {
  const clean = ip.replace(/^::ffff:/i, ''); // IPv4 mapeada en IPv6
  const parts = clean.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function ipAllowed(ip: string, allowedList: string | undefined): boolean {
  const entries = (allowedList ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return true; // sin restriccion configurada

  if (ip === '127.0.0.1' || ip === '::1') return true; // loopback siempre
  const value = ipv4ToInt(ip);

  for (const entry of entries) {
    if (entry === ip) return true;
    const [base, bits] = entry.split('/');
    if (bits !== undefined && base && value !== null) {
      const baseInt = ipv4ToInt(base);
      const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      if (baseInt !== null && (value & mask) === (baseInt & mask)) return true;
    }
  }
  return false;
}
