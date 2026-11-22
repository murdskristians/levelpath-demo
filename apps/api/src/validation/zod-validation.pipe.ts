import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

/** One `{ path, message }` per Zod issue, the path joined by `.` ('' for the value itself). */
export function zodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Parses a request body with one of the shared Zod schemas:
 * `@Body(new ZodValidationPipe(createPurchaseRequestSchema))`. The route gets the
 * parsed output (trimmed, defaults filled in). A body that fails, or no body at all,
 * is a 400 that lists every issue, with its path joined by `.` ('' for the body itself).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      statusCode: 400,
      message: 'Invalid request body',
      issues: zodIssues(result.error),
    });
  }
}
