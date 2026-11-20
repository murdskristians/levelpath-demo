// The value lists the database CHECK constraints allow, defined once for the API.
// A test checks the database accepts every one of them, so the two can't drift.
// Phase 3 moves them to packages/shared when the web app needs them too.

export const USER_ROLES = ['requester', 'approver'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PURCHASE_REQUEST_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
