import { BadRequestException } from '@nestjs/common';
import {
  apiErrorSchema,
  createPurchaseRequestSchema,
  decisionSchema,
  type ApiError,
} from '@levelpath/shared';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from './zod-validation.pipe.js';

// The pipe on its own (no database): the parsed output on success, and the contract's
// 400 body, with one { path, message } per Zod issue, on failure.

const create = new ZodValidationPipe(createPurchaseRequestSchema);
const decide = new ZodValidationPipe(decisionSchema);
const SUPPLIER = 'a0000000-0000-4000-8000-000000000201';

function rejection(pipe: ZodValidationPipe<unknown>, value: unknown): ApiError {
  try {
    pipe.transform(value);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return apiErrorSchema.parse((err as BadRequestException).getResponse());
  }
  throw new Error('expected the pipe to reject the value');
}

const paths = (error: ApiError) => (error.issues ?? []).map((issue) => issue.path);

describe('ZodValidationPipe', () => {
  it('returns the parsed body: the title trimmed, the currency and description defaulted', () => {
    expect(
      create.transform({
        title: '  Chairs  ',
        amountCents: 100,
        supplierId: SUPPLIER,
        category: 'other',
      }),
    ).toEqual({
      title: 'Chairs',
      amountCents: 100,
      currency: 'EUR',
      supplierId: SUPPLIER,
      category: 'other',
      description: '',
    });
    expect(decide.transform({ decision: 'approved' })).toEqual({
      decision: 'approved',
      comment: '',
    });
  });

  it('rejects an unknown key with an issue on the body itself', () => {
    const error = rejection(create, {
      title: 'x',
      amountCents: 100,
      supplierId: SUPPLIER,
      category: 'other',
      id: 'a0000000-0000-4000-8000-000000000999',
    });
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid request body');
    expect(paths(error)).toEqual(['']);
  });

  it('rejects a missing body with an issue at path ""', () => {
    expect(paths(rejection(create, undefined))).toEqual(['']);
  });

  it('names the field: an empty title is at "title"', () => {
    expect(
      paths(
        rejection(create, {
          title: '  ',
          amountCents: 100,
          supplierId: SUPPLIER,
          category: 'other',
        }),
      ),
    ).toEqual(['title']);
  });

  it('a rejection without a comment is at "comment"', () => {
    expect(paths(rejection(decide, { decision: 'rejected' }))).toEqual(['comment']);
  });

  it('lists every issue, each with a message', () => {
    const error = rejection(create, {
      title: '',
      amountCents: 1.5,
      supplierId: 'not-a-uuid',
      category: 'furniture',
    });
    expect(paths(error).sort()).toEqual(['amountCents', 'category', 'supplierId', 'title']);
    for (const issue of error.issues ?? []) expect(issue.message).not.toBe('');
  });
});
