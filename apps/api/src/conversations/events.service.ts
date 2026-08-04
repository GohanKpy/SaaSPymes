import { Injectable, type MessageEvent } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

/**
 * Eventos en vivo por tenant para la bandeja (SSE, doc 01 §3.4).
 * En memoria: valido para la instancia unica de fase 1. Cuando el worker
 * procese colas en proceso aparte, esto migra a LISTEN/NOTIFY de Postgres.
 */
@Injectable()
export class TenantEventsService {
  private readonly subjects = new Map<string, Subject<MessageEvent>>();

  private subject(tenantId: string): Subject<MessageEvent> {
    let subject = this.subjects.get(tenantId);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.subjects.set(tenantId, subject);
    }
    return subject;
  }

  stream(tenantId: string): Observable<MessageEvent> {
    return this.subject(tenantId).asObservable();
  }

  /** Tipos de evento del contrato SSE (doc 04 §3.7). */
  emit(
    tenantId: string,
    type: 'message.new' | 'message.status' | 'conversation.updated' | 'invoice.status',
    data: unknown,
  ): void {
    this.subject(tenantId).next({ type, data: JSON.stringify(data) });
  }
}
