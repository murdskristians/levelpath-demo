import type { PurchaseRequest } from '@levelpath/shared';
import type { InferResult } from 'kysely';
import type { TenantTransaction } from '../db/database.service.js';

/**
 * Purchase requests with their supplier, their requester and their latest decision,
 * one row per request: the base query every route filters and orders. It only runs
 * on a tenant transaction, so RLS limits every joined table to the caller's company,
 * and the composite foreign keys keep each join inside it.
 */
export function selectPurchaseRequests(trx: TenantTransaction) {
  return trx
    .selectFrom('purchase_requests as pr')
    .innerJoin('suppliers as s', 's.id', 'pr.supplier_id')
    .innerJoin('users as r', 'r.id', 'pr.requester_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('approvals as a')
          .innerJoin('users as ap', 'ap.id', 'a.approver_id')
          .select([
            'a.decision',
            'a.comment',
            'a.decided_at',
            'ap.id as approver_id',
            'ap.name as approver_name',
          ])
          .whereRef('a.purchase_request_id', '=', 'pr.id')
          // The latest one, so a request never appears twice even with two approvals.
          .orderBy('a.decided_at', 'desc')
          .orderBy('a.id', 'desc')
          .limit(1)
          .as('d'),
      (join) => join.onTrue(),
    )
    .select([
      'pr.id',
      'pr.title',
      'pr.amount_cents',
      'pr.currency',
      'pr.status',
      'pr.category',
      'pr.description',
      'pr.created_at',
      'pr.updated_at',
      's.id as supplier_id',
      's.name as supplier_name',
      'r.id as requester_id',
      'r.name as requester_name',
      'd.decision',
      'd.comment',
      'd.decided_at',
      'd.approver_id',
      'd.approver_name',
    ]);
}

export type PurchaseRequestRow = InferResult<ReturnType<typeof selectPurchaseRequests>>[number];

/** The row as the contract's PurchaseRequest: an integer amount, ISO timestamps. */
export function toPurchaseRequest(row: PurchaseRequestRow): PurchaseRequest {
  return {
    id: row.id,
    title: row.title,
    // bigint arrives as a string; MAX_AMOUNT_CENTS keeps it an exact JS integer.
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    status: row.status,
    category: row.category,
    description: row.description,
    supplier: { id: row.supplier_id, name: row.supplier_name },
    requester: { id: row.requester_id, name: row.requester_name },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    decision:
      row.decision === null ||
      row.decided_at === null ||
      row.approver_id === null ||
      row.approver_name === null
        ? null
        : {
            decision: row.decision,
            comment: row.comment,
            approver: { id: row.approver_id, name: row.approver_name },
            decidedAt: row.decided_at.toISOString(),
          },
  };
}
