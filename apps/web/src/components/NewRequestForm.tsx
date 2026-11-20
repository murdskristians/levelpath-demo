import { createPurchaseRequestSchema, type Supplier } from '@levelpath/shared';
import { useState, type FormEvent } from 'react';
import { parseAmountToCents } from '../money';

type Field = 'title' | 'amount' | 'currency' | 'supplier';
type Errors = Partial<Record<Field, string>>;

const MESSAGES: Record<Field, string> = {
  title: 'Enter a title of 1 to 200 characters.',
  amount: 'Enter an amount of 0 or more, like 12.50.',
  currency: 'Use a three-letter upper-case code, like EUR.',
  supplier: 'Choose a supplier.',
};
const FIELD_OF_PATH: Record<string, Field> = {
  title: 'title',
  amountCents: 'amount',
  currency: 'currency',
  supplierId: 'supplier',
};

export function NewRequestForm({
  suppliers,
  onCreate,
  onCancel,
}: {
  suppliers: Supplier[];
  onCreate: (input: {
    title: string;
    amountCents: number;
    currency: string;
    supplierId: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [supplierId, setSupplierId] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cents = parseAmountToCents(amount);
    const found: Errors = {};
    if (cents === null) found.amount = MESSAGES.amount;
    const result = createPurchaseRequestSchema.safeParse({
      title,
      amountCents: cents ?? 0,
      currency,
      supplierId,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = FIELD_OF_PATH[String(issue.path[0])];
        if (field) found[field] = MESSAGES[field];
      }
    }
    setErrors(found);
    if (!result.success || Object.keys(found).length > 0) return;
    await onCreate(result.data);
  }

  function aria(name: Field) {
    return {
      'aria-invalid': errors[name] ? true : undefined,
      'aria-describedby': errors[name] ? `${name}-error` : undefined,
    };
  }
  const message = (name: Field) =>
    errors[name] ? (
      <p id={`${name}-error`} className="field-error">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="request-form" aria-label="New request">
      <div className="form-field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          {...aria('title')}
        />
        {message('title')}
      </div>
      <div className="form-field">
        <label htmlFor="amount">Amount</label>
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          {...aria('amount')}
        />
        {message('amount')}
      </div>
      <div className="form-field">
        <label htmlFor="currency">Currency</label>
        <input
          id="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          {...aria('currency')}
        />
        {message('currency')}
      </div>
      <div className="form-field">
        <label htmlFor="supplier">Supplier</label>
        <select
          id="supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          {...aria('supplier')}
        >
          <option value="">Choose a supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {message('supplier')}
      </div>
      <div className="form-actions">
        <button type="submit">Create request</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
