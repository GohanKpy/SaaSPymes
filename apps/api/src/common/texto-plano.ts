/**
 * Limpieza de formato a la salida de los modelos (ADR 0011): el prompt
 * prohibe Markdown, pero los modelos economicos igual devuelven **negritas**
 * y encabezados que WhatsApp y las burbujas del panel muestran crudos. Se
 * garantiza aca, de forma deterministica, en vez de confiar en que el modelo
 * obedezca. Compartida por el bot de WhatsApp y el asistente del portal admin.
 */
export function aTextoPlano(texto: string): string {
  const sinMarkdown = texto
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ');
  // Varios horarios sueltos en una misma linea ("- 08:00 - 12:00" eran DOS
  // turnos libres y el cliente lo leyo como "de 8 a 12", conversacion
  // 2026-09-02): uno por linea. Los rangos reales se escriben con "a".
  return sinMarkdown
    .split('\n')
    .flatMap((linea) => {
      const soloHoras = /^\s*-?\s*\d{1,2}:\d{2}(\s*[-–·,]\s*\d{1,2}:\d{2})+\s*$/.test(linea);
      if (!soloHoras) return [linea];
      return (linea.match(/\d{1,2}:\d{2}/g) ?? []).map((h) => `- ${h}`);
    })
    .join('\n');
}
