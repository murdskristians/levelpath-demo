import { z } from 'zod';
import { APPROVAL_DECISIONS, PURCHASE_REQUEST_STATUSES } from './values.js';

// The Phase 3 API contract (docs/specs/purchase-requests-contract.md) as Zod schemas.
// The API validates every request body with them; the web app validates its forms
// with the same ones and reads the responses with the response schemas.

/** The largest amount, in cents: 100 million in any currency. Keeps it an exact integer. */
export const MAX_AMOUNT_CENTS = 10_000_000_000;

export const supplierSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const personSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
});
export type Person = z.infer<typeof personSchema>;

/**
 * POST /purchase-requests. Strict: an `id`, a `tenantId`, a `status` or any other key
 * the client adds is rejected, so the client can't choose what Postgres or the
 * caller's session decides.
 */
export const createPurchaseRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  amountCents: z.int().min(0).max(MAX_AMOUNT_CENTS),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'a three-letter currency code, like EUR')
    .default('EUR'),
  supplierId: z.uuid(),
});
/** What a client sends (currency may be left out). */
export type CreatePurchaseRequestInput = z.input<typeof createPurchaseRequestSchema>;
/** What the API works with after parsing (currency filled in). */
export type CreatePurchaseRequest = z.output<typeof createPurchaseRequestSchema>;

/** POST /purchase-requests/:id/decision. A rejection needs a comment saying why. */
export const decisionSchema = z
  .strictObject({
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().trim().max(1000).default(''),
  })
  .refine((d) => d.decision === 'approved' || d.comment.length > 0, {
    path: ['comment'],
    message: 'a rejection needs a comment',
  });
export type DecisionInput = z.input<typeof decisionSchema>;
export type Decision = z.output<typeof decisionSchema>;

/** A purchase request as every route returns it. */
export const purchaseRequestSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  amountCents: z.int().min(0).max(MAX_AMOUNT_CENTS),
  currency: z.string(),
  status: z.enum(PURCHASE_REQUEST_STATUSES),
  supplier: supplierSchema,
  requester: personSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  decision: z
    .strictObject({
      decision: z.enum(APPROVAL_DECISIONS),
      comment: z.string().nullable(),
      approver: personSchema,
      decidedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;

/** Every error response. A 400 from schema validation also lists the issues. */
export const apiErrorSchema = z.object({
  statusCode: z.int(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
