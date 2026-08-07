// Digito verificador de RUC paraguayo (modulo 11, algoritmo oficial SET).
// Espejo de apps/web/lib/ruc.ts; validado contra RUCs reales.
export function dvRuc(ruc: string): string | null {
  const digits = ruc.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 8) return null;
  let k = 2;
  let total = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    total += k * Number(digits[i]);
    k = k === 11 ? 2 : k + 1;
  }
  const resto = total % 11;
  return String(resto > 1 ? 11 - resto : 0);
}
