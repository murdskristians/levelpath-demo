import { z } from 'zod';
import {
  APPROVAL_DECISIONS,
  PURCHASE_REQUEST_CATEGORIES,
  PURCHASE_REQUEST_STATUSES,
} from './values.js';

// The Phase 3 API contract (docs/specs/purchase-requests-contract.md) as Zod schemas.
// The API validates every request body with them; the web app validates its forms
// with the same ones and reads the responses with the response schemas.

/** The largest amount, in cents: 100 million in any currency. Keeps it an exact integer. */
export const MAX_AMOUNT_CENTS = 10_000_000_000;

/** The longest description, in characters (the database CHECK says the same). */
export const MAX_DESCRIPTION_LENGTH = 2000;

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'a three-letter currency code, like EUR');

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
  currency: currencyCode.default('EUR'),
  supplierId: z.uuid(),
  category: z.enum(PURCHASE_REQUEST_CATEGORIES),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).default(''),
});
/** What a client sends (currency may be left out). */
export type CreatePurchaseRequestInput = z.input<typeof createPurchaseRequestSchema>;
/** What the API works with after parsing (currency filled in). */
export type CreatePurchaseRequest = z.output<typeof createPurchaseRequestSchema>;

/** PUT /purchase-requests/:id: the same fields and rules as create, strict for the same reason. */
export const updatePurchaseRequestSchema = createPurchaseRequestSchema;
export type UpdatePurchaseRequestInput = z.input<typeof updatePurchaseRequestSchema>;
export type UpdatePurchaseRequest = z.output<typeof updatePurchaseRequestSchema>;

/** POST /purchase-requests/:id/decision. A rejection needs a comment saying why. */
export const decisionSchema = z
  .strictObject({
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().trim().max(1000).default(''),
  })
  .refine((d) => d.decision === 'approved' || d.comment.length > 0, {
    path: ['comment'],
    message: 'A rejection needs a comment.',
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
  category: z.enum(PURCHASE_REQUEST_CATEGORIES),
  description: z.string(),
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

/** POST /purchase-requests/suggestion. Strict: the client can't send suppliers or a tenant. */
export const suggestionRequestSchema = z.strictObject({
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
});
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;

/**
 * What the model must return, and what the API answers with. The API parses every
 * provider output with it, so it is the only judge of a suggestion (no `.default()`
 * or transforms beyond trim: the real provider sends it to the model as JSON Schema).
 * `null` means "not in the description": the form leaves that field alone.
 */
export const suggestionSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  category: z.enum(PURCHASE_REQUEST_CATEGORIES),
  quantity: z.int().min(1).max(1_000_000).nullable(),
  amountCents: z.int().min(0).max(MAX_AMOUNT_CENTS).nullable(),
  currency: currencyCode.nullable(),
  supplierId: z.uuid().nullable(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

/** The route's only success shape: `suggestion` is null when the LLM gave nothing usable. */
export const suggestionResponseSchema = z.strictObject({
  suggestion: suggestionSchema.nullable(),
});
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

/** Every error response. A 400 from schema validation also lists the issues. */
export const apiErrorSchema = z.object({
  statusCode: z.int(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
