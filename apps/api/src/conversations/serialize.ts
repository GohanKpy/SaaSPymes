// Serializacion de mensajes para la API y SSE. Vive aparte de
// conversations.service para que notifier/wa-sender no importen ese modulo
// (2026-09-14: importarlo cerraba un ciclo bot → returns → inventory →
// notifier → conversations → bot y Nest recibia undefined al inyectar).

export function serializeMessage(m: {
  id: bigint;
  conversationId: string;
  direction: string;
  senderType: string;
  body: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: String(m.id),
    conversation_id: m.conversationId,
    direction: m.direction,
    sender_type: m.senderType,
    body: m.body,
    status: m.status,
    created_at: m.createdAt.toISOString(),
  };
}
