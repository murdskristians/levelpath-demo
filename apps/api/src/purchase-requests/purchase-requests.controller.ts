import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  type CreatePurchaseRequest,
  createPurchaseRequestSchema,
  type Decision,
  decisionSchema,
  type PurchaseRequest,
  type UpdatePurchaseRequest,
  updatePurchaseRequestSchema,
} from '@levelpath/shared';
import { ApproverGuard } from '../auth/approver.guard.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

// The purchase-request routes of docs/specs/purchase-requests-contract.md. Nest runs
// the guards (AuthGuard, then ApproverGuard) before the body pipe, so a requester on
// an approver-only route gets 403 whatever they send. `:id` has no ParseUUIDPipe: that
// answers 400, and the contract says a non-UUID id is a 404 (the service checks it).
@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequests: PurchaseRequestsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser): Promise<PurchaseRequest[]> {
    return this.purchaseRequests.mine(user);
  }

  @Get('to-decide')
  @UseGuards(ApproverGuard)
  toDecide(@CurrentUser() user: AuthUser): Promise<PurchaseRequest[]> {
    return this.purchaseRequests.toDecide(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPurchaseRequestSchema)) body: CreatePurchaseRequest,
  ): Promise<PurchaseRequest> {
    return this.purchaseRequests.create(user, body);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseRequestSchema)) body: UpdatePurchaseRequest,
  ): Promise<PurchaseRequest> {
    return this.purchaseRequests.update(user, id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<PurchaseRequest> {
    return this.purchaseRequests.submit(user, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @UseGuards(ApproverGuard)
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decisionSchema)) body: Decision,
  ): Promise<PurchaseRequest> {
    return this.purchaseRequests.decide(user, id, body);
  }
}
