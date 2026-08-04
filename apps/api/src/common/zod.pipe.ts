import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** 422 con detalle por campo; el filtro lo convierte a problem+json. */
export class ZodValidationException extends Error {
  constructor(readonly fieldErrors: Record<string, string[]>) {
    super('validation');
  }
}

/** Valida body/query/params con los DTOs zod de @pymes/shared (doc 04 §4). */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        (errors[key] ??= []).push(issue.message);
      }
      throw new ZodValidationException(errors);
    }
    return parsed.data;
  }
}
