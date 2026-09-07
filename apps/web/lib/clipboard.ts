/**
 * Copiar al portapapeles con respaldo (pedido de Johan 2026-09-07). El API
 * moderno (navigator.clipboard) solo existe en HTTPS o localhost: entrando
 * por la IP de la red local en http no copiaba nada y no avisaba. Devuelve
 * si pudo copiar; quien llama muestra el aviso.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // se intenta el respaldo
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, texto.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Formato en una linea para pegar en un chat: "Usuario: ana | Contraseña: AsQ123". */
export function formatoCredenciales(usuario: string, contrasena: string): string {
  return `Usuario: ${usuario} | Contraseña: ${contrasena}`;
}
