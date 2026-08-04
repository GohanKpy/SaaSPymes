import { randomUUID } from 'node:crypto';

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@pymes/db';
import type { FastifyReply } from 'fastify';

import { ZodValidationException } from './zod.pipe';

const DOCS = 'https://docs.pymes.local/errors';

interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Record<string, string[]>;
  trace_id: string;
}

/** Errores como application/problem+json, RFC 7807 (doc 04 §1). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const traceId = randomUUID();

    let problem: Problem;
    if (exception instanceof ZodValidationException) {
      problem = {
        type: `${DOCS}/validation`,
        title: 'Datos invalidos',
        status: 422,
        errors: exception.fieldErrors,
        trace_id: traceId,
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const body = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
      problem = {
        type: typeof body.type === 'string' ? body.type : `${DOCS}/http-${status}`,
        title: typeof body.title === 'string' ? body.title : exception.message,
        status,
        detail: typeof body.detail === 'string' ? body.detail : undefined,
        trace_id: traceId,
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      problem = this.fromPrisma(exception, traceId);
    } else {
      this.logger.error(`trace_id=${traceId}`, exception instanceof Error ? exception.stack : String(exception));
      problem = {
        type: `${DOCS}/internal`,
        title: 'Error interno',
        status: 500,
        trace_id: traceId,
      };
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problem);
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError, traceId: string): Problem {
    switch (e.code) {
      case 'P2002': // unique violation → 409 informativo (doc 04 §3.4)
        return {
          type: `${DOCS}/conflict`,
          title: 'Ya existe un registro con esos datos',
          status: HttpStatus.CONFLICT,
          detail: `restriccion: ${String((e.meta as Record<string, unknown> | undefined)?.target ?? 'unica')}`,
          trace_id: traceId,
        };
      case 'P2003': // FK compuesta: referencia inexistente o de otro tenant
      case 'P2025':
        // 404 opaco: inexistente o de otro tenant, indistinguible (doc 04 §5)
        return {
          type: `${DOCS}/not-found`,
          title: 'No existe',
          status: HttpStatus.NOT_FOUND,
          trace_id: traceId,
        };
      default:
        this.logger.error(`prisma ${e.code} trace_id=${traceId}`, e.message);
        return {
          type: `${DOCS}/internal`,
          title: 'Error interno',
          status: 500,
          trace_id: traceId,
        };
    }
  }
}
