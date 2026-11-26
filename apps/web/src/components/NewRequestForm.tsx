import {
  createPurchaseRequestSchema,
  MAX_DESCRIPTION_LENGTH,
  type CreatePurchaseRequestInput,
  type PurchaseRequest,
  type Suggestion,
  type SuggestionResponse,
  type Supplier,
} from '@levelpath/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CATEGORY_OPTIONS } from '../categories';
import { centsToAmountText, parseAmountToCents } from '../money';

type Field = 'description' | 'title' | 'category' | 'amount' | 'currency' | 'supplier';
type Errors = Partial<Record<Field, string>>;
/** The fields a suggestion can fill. Quantity is not shown (spec requirement 21). */
type SuggestedField = Exclude<Field, 'description'>;

const MESSAGES: Record<Field, string> = {
  description: `Keep the description to ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
  title: 'Enter a title of 1 to 200 characters.',
  category: 'Choose a category.',
  amount: 'Enter an amount of 0 or more, like 12.50.',
  currency: 'Use a three-letter upper-case code, like EUR.',
  supplier: 'Choose a supplier.',
};
const FIELD_OF_PATH: Record<string, Field> = {
  description: 'description',
  title: 'title',
  category: 'category',
  amountCents: 'amount',
  currency: 'currency',
  supplierId: 'supplier',
};

export function NewRequestForm({
  suppliers,
  initial,
  onSave,
  onSuggest,
  onCancel,
}: {
  suppliers: Supplier[];
  /** The draft being edited; without it the form creates a new request. */
  initial?: PurchaseRequest;
  onSave: (input: CreatePurchaseRequestInput) => Promise<void>;
  onSuggest: (description: string) => Promise<SuggestionResponse>;
  onCancel: () => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState<string>(initial?.category ?? '');
  const [amount, setAmount] = useState(initial ? centsToAmountText(initial.amountCents) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [supplierId, setSupplierId] = useState(initial?.supplier.id ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<ReadonlySet<SuggestedField>>(new Set());
  const [note, setNote] = useState(false);

  /** An edit by the user: the field is theirs again, so its tag goes. */
  function edited(name: SuggestedField) {
    setSuggested((tags) => {
      if (!tags.has(name)) return tags;
      const next = new Set(tags);
      next.delete(name);
      return next;
    });
  }

  /** Fills every non-null field and tags it; null fields keep what the user typed (A7). */
  function apply(s: Suggestion) {
    const filled: SuggestedField[] = ['title', 'category'];
    setTitle(s.title);
    setCategory(s.category);
    if (s.amountCents !== null) {
      setAmount(centsToAmountText(s.amountCents));
      filled.push('amount');
    }
    if (s.currency !== null) {
      setCurrency(s.currency);
      filled.push('currency');
    }
    // The API already drops another tenant's id; this form only offers its own list.
    if (s.supplierId !== null && suppliers.some((x) => x.id === s.supplierId)) {
      setSupplierId(s.supplierId);
      filled.push('supplier');
    }
    setSuggested((tags) => new Set([...tags, ...filled]));
  }

  async function handleSuggest() {
    setSuggesting(true);
    setNote(false);
    try {
      const { suggestion } = await onSuggest(description);
      if (suggestion) apply(suggestion);
      else setNote(true); // The API fell back and logged why.
    } catch (err) {
      // Network, non-2xx or a body that fails the schema: the note, not the ErrorAlert.
      // Deliberate, not a leftover: the note hides the cause, so the console keeps it.
      console.error('suggestion failed', err);
      setNote(true);
    } finally {
      setSuggesting(false);
    }
  }

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
      category,
      description,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = FIELD_OF_PATH[String(issue.path[0])];
        if (field) found[field] = MESSAGES[field];
      }
    }
    setErrors(found);
    if (!result.success || Object.keys(found).length > 0) return;
    await onSave(result.data);
  }

  function aria(name: Field) {
    const ids = [
      errors[name] ? `${name}-error` : null,
      name !== 'description' && suggested.has(name) ? `${name}-suggested` : null,
    ].filter(Boolean);
    return {
      'aria-invalid': errors[name] ? true : undefined,
      'aria-describedby': ids.length > 0 ? ids.join(' ') : undefined,
    };
  }
  /** The label, then the tag outside it, so the label's text stays the field's name. */
  const head = (name: SuggestedField, text: string) => (
    <div className="field-head">
      <label htmlFor={name}>{text}</label>
      {suggested.has(name) && (
        <span className="suggested-tag" id={`${name}-suggested`}>
          Suggested
        </span>
      )}
    </div>
  );
  const message = (name: Field) =>
    errors[name] ? (
      <p id={`${name}-error`} className="field-error">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="request-form"
      aria-label={initial ? 'Edit request' : 'New request'}
    >
      <div className="form-field">
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          {...aria('description')}
        />
        {message('description')}
      </div>
      <div className="suggest-row">
        <button
          type="button"
          className="secondary"
          disabled={description.trim() === '' || suggesting}
          onClick={() => void handleSuggest()}
        >
          {suggesting ? 'Suggesting…' : 'Suggest fields'}
        </button>
        {/* Always in the page, so screen readers announce the note when it appears. */}
        <p role="status" className="form-note">
          {note ? 'No suggestion this time. Fill in the fields yourself.' : ''}
        </p>
      </div>
      <div className="form-field">
        {head('title', 'Title')}
        <input
          id="title"
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            edited('title');
          }}
          {...aria('title')}
        />
        {message('title')}
      </div>
      <div className="form-field">
        {head('category', 'Category')}
        <select
          id="category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            edited('category');
          }}
          {...aria('category')}
        >
          <option value="">Choose a category</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {message('category')}
      </div>
      <div className="form-field">
        {head('amount', 'Amount')}
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            edited('amount');
          }}
          {...aria('amount')}
        />
        {message('amount')}
      </div>
      <div className="form-field">
        {head('currency', 'Currency')}
        <input
          id="currency"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            edited('currency');
          }}
          {...aria('currency')}
        />
        {message('currency')}
      </div>
      <div className="form-field">
        {head('supplier', 'Supplier')}
        <select
          id="supplier"
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            edited('supplier');
          }}
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
        <button type="submit">{initial ? 'Save changes' : 'Create request'}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
