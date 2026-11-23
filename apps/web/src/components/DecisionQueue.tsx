import { decisionSchema, type PurchaseRequest } from '@levelpath/shared';
import { useState } from 'react';
import { CATEGORY_LABELS } from '../categories';
import { formatAmount } from '../money';

type OnDecide = (id: string, input: { decision: 'approved' | 'rejected'; comment: string }) => void;

function DecisionItem({ request, onDecide }: { request: PurchaseRequest; onDecide: OnDecide }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const commentId = `comment-${request.id}`;

  function decide(decision: 'approved' | 'rejected') {
    const result = decisionSchema.safeParse({ decision, comment });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the comment.');
      return;
    }
    setError(null);
    onDecide(request.id, result.data);
  }

  return (
    <li>
      <h3>{request.title}</h3>
      <p>
        {formatAmount(request.amountCents, request.currency)} · {request.supplier.name} ·{' '}
        {CATEGORY_LABELS[request.category]} · from {request.requester.name}
      </p>
      {/* Text the requester typed: a React text child, so it is never parsed as HTML. */}
      {request.description && <p>{request.description}</p>}
      <label htmlFor={commentId}>{`Comment on ${request.title}`}</label>
      <textarea
        id={commentId}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${commentId}-error` : undefined}
      />
      {error && (
        <p id={`${commentId}-error`} className="field-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          aria-label={`Approve ${request.title}`}
          onClick={() => decide('approved')}
        >
          Approve
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Reject ${request.title}`}
          onClick={() => decide('rejected')}
        >
          Reject
        </button>
      </div>
    </li>
  );
}

export function DecisionQueue({
  requests,
  onDecide,
}: {
  requests: PurchaseRequest[];
  onDecide: OnDecide;
}) {
  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading">Waiting for your decision</h2>
      {requests.length === 0 ? (
        <div className="empty-state">
          <p>Nothing is waiting for your decision.</p>
        </div>
      ) : (
        <ul className="request-list">
          {requests.map((r) => (
            <DecisionItem key={r.id} request={r} onDecide={onDecide} />
          ))}
        </ul>
      )}
    </section>
  );
}
