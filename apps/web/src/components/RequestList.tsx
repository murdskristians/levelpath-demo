import type { PurchaseRequest } from '@levelpath/shared';
import { CATEGORY_LABELS } from '../categories';
import { formatAmount } from '../money';

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function RequestList({
  requests,
  onSubmit,
}: {
  requests: PurchaseRequest[];
  onSubmit: (id: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="empty-state">
        <p>No purchase requests yet.</p>
        <p>Use New request to create your first one.</p>
      </div>
    );
  }
  return (
    <ul className="request-list">
      {requests.map((r) => (
        <li key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {formatAmount(r.amountCents, r.currency)} · {r.supplier.name} ·{' '}
            {CATEGORY_LABELS[r.category]}
          </p>
          <p>
            <StatusBadge status={r.status} />
          </p>
          {r.decision && (
            <p>
              {r.decision.decision === 'approved' ? 'Approved' : 'Rejected'} by{' '}
              {r.decision.approver.name}
              {r.decision.comment ? `: ${r.decision.comment}` : ''}
            </p>
          )}
          {r.status === 'draft' && (
            <button type="button" onClick={() => onSubmit(r.id)}>
              Submit
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
