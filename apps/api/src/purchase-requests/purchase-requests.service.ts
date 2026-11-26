import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePurchaseRequest,
  Decision,
  PurchaseRequest,
  UpdatePurchaseRequest,
} from '@levelpath/shared';
import { sql } from 'kysely';
import type { AuthUser } from '../auth/auth-user.js';
import { DatabaseService, type TenantTransaction } from '../db/database.service.js';
import { isKeyViolation } from '../db/pg-errors.js';
import { isUuid } from '../db/uuid.js';
import { selectPurchaseRequests, toPurchaseRequest } from './purchase-request.query.js';

/**
 * Purchase requests from draft to decision. Everything runs in the caller's tenant
 * transaction; the tenant, the requester and the approver come only from the caller.
 * Anything the caller may not see is a 404 with the same body, whatever the reason.
 */
@Injectable()
export class PurchaseRequestsService {
  constructor(private readonly db: DatabaseService) {}

  /** Every request the caller created, newest first. */
  mine(user: AuthUser): Promise<PurchaseRequest[]> {
    return this.db.withTenant(user.tenantId, async (trx) => {
      const rows = await selectPurchaseRequests(trx)
        .where('pr.requester_id', '=', user.userId)
        .orderBy('pr.created_at', 'desc')
        .orderBy('pr.id', 'desc')
        .execute();
      return rows.map(toPurchaseRequest);
    });
  }

  /** Every submitted request of the caller's company, oldest first (approvers only). */
  toDecide(user: AuthUser): Promise<PurchaseRequest[]> {
    return this.db.withTenant(user.tenantId, async (trx) => {
      const rows = await selectPurchaseRequests(trx)
        .where('pr.status', '=', 'submitted')
        .orderBy('pr.created_at', 'asc')
        .orderBy('pr.id', 'asc')
        .execute();
      return rows.map(toPurchaseRequest);
    });
  }

  /** A new draft by the caller. An unknown or other-company supplier is a 404. */
  create(user: AuthUser, input: CreatePurchaseRequest): Promise<PurchaseRequest> {
    return this.db.withTenant(user.tenantId, async (trx) => {
      let id: string;
      try {
        ({ id } = await trx
          .insertInto('purchase_requests')
          .values({
            tenant_id: user.tenantId,
            requester_id: user.userId,
            supplier_id: input.supplierId,
            title: input.title,
            amount_cents: input.amountCents,
            currency: input.currency,
            category: input.category,
            description: input.description,
          })
          .returning('id')
          .executeTakeFirstOrThrow());
      } catch (err) {
        // The composite foreign key to suppliers: unknown, or another company's.
        if (isKeyViolation(err)) throw new NotFoundException();
        throw err;
      }
      return readBack(trx, id);
    });
  }

  /** The caller's own draft gets new field values. Not theirs or not found: 404; not a draft: 409. */
  update(user: AuthUser, id: string, input: UpdatePurchaseRequest): Promise<PurchaseRequest> {
    if (!isUuid(id)) throw new NotFoundException();
    return this.db.withTenant(user.tenantId, async (trx) => {
      const request = await trx
        .selectFrom('purchase_requests')
        .select(['id', 'status'])
        .where('id', '=', id)
        .where('requester_id', '=', user.userId)
        .executeTakeFirst();
      if (!request) throw new NotFoundException();
      if (request.status !== 'draft') throw new ConflictException('only a draft can be edited');
      let updated: { id: string } | undefined;
      try {
        // Conditional on the status, so a concurrent submit can't be overwritten.
        updated = await trx
          .updateTable('purchase_requests')
          .set({
            supplier_id: input.supplierId,
            title: input.title,
            amount_cents: input.amountCents,
            currency: input.currency,
            category: input.category,
            description: input.description,
            updated_at: sql<Date>`now()`,
          })
          .where('id', '=', id)
          .where('status', '=', 'draft')
          .returning('id')
          .executeTakeFirst();
      } catch (err) {
        // The composite foreign key to suppliers: unknown, or another company's.
        if (isKeyViolation(err)) throw new NotFoundException();
        throw err;
      }
      if (!updated) throw new ConflictException('only a draft can be edited');
      return readBack(trx, id);
    });
  }

  /** The caller's own draft becomes submitted. */
  submit(user: AuthUser, id: string): Promise<PurchaseRequest> {
    if (!isUuid(id)) throw new NotFoundException();
    return this.db.withTenant(user.tenantId, async (trx) => {
      const request = await trx
        .selectFrom('purchase_requests')
        .select(['id', 'status'])
        .where('id', '=', id)
        .where('requester_id', '=', user.userId)
        .executeTakeFirst();
      if (!request) throw new NotFoundException();
      if (request.status !== 'draft') throw new ConflictException('only a draft can be submitted');
      // Conditional on the status, so a concurrent change can't be overwritten.
      const updated = await trx
        .updateTable('purchase_requests')
        .set({ status: 'submitted', updated_at: sql<Date>`now()` })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirst();
      if (!updated) throw new ConflictException('only a draft can be submitted');
      return readBack(trx, id);
    });
  }

  /** An approver approves or rejects a submitted request someone else created. */
  decide(user: AuthUser, id: string, input: Decision): Promise<PurchaseRequest> {
    // ApproverGuard already checked this; repeated so the rule holds wherever this is called.
    if (user.role !== 'approver') throw new ForbiddenException();
    if (!isUuid(id)) throw new NotFoundException();
    return this.db.withTenant(user.tenantId, async (trx) => {
      // Another requester's draft is private to them: it is not found, like any unseen id.
      const request = await trx
        .selectFrom('purchase_requests')
        .select(['id', 'status', 'requester_id'])
        .where('id', '=', id)
        .where((eb) => eb.or([eb('requester_id', '=', user.userId), eb('status', '<>', 'draft')]))
        .executeTakeFirst();
      if (!request) throw new NotFoundException();
      if (request.requester_id === user.userId) throw new ForbiddenException();
      if (request.status !== 'submitted') {
        throw new ConflictException('only a submitted request can be decided');
      }
      // Under READ COMMITTED a concurrent decision waits for this row's lock, then
      // re-checks the WHERE and updates nothing: it gets the 409, and writes no approval.
      const updated = await trx
        .updateTable('purchase_requests')
        .set({ status: input.decision, updated_at: sql<Date>`now()` })
        .where('id', '=', id)
        .where('status', '=', 'submitted')
        .returning('id')
        .executeTakeFirst();
      if (!updated) throw new ConflictException('only a submitted request can be decided');
      await trx
        .insertInto('approvals')
        .values({
          tenant_id: user.tenantId,
          purchase_request_id: id,
          approver_id: user.userId,
          decision: input.decision,
          comment: input.comment === '' ? null : input.comment,
        })
        .execute();
      return readBack(trx, id);
    });
  }
}

async function readBack(trx: TenantTransaction, id: string): Promise<PurchaseRequest> {
  const row = await selectPurchaseRequests(trx).where('pr.id', '=', id).executeTakeFirstOrThrow();
  return toPurchaseRequest(row);
}
