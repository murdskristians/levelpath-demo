import type { PurchaseRequest, Supplier } from '@levelpath/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './App.css';
import { createApi, type Me } from './api';
import { DecisionQueue } from './components/DecisionQueue';
import { ErrorAlert } from './components/ErrorAlert';
import { NewRequestForm } from './components/NewRequestForm';
import { RequestList } from './components/RequestList';
import { ThemeToggle } from './components/ThemeToggle';
import { UserPicker } from './components/UserPicker';
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme';
import { loadUserId, saveUserId } from './users';

type DecideInput = { decision: 'approved' | 'rejected'; comment: string };

/** Everything for one user. App keys it by user id, so switching users resets it all. */
function Dashboard({ userId, picker }: { userId: string; picker: ReactNode }) {
  const api = useMemo(() => createApi(userId), [userId]);
  const [me, setMe] = useState<Me | null>(null);
  const [mine, setMine] = useState<PurchaseRequest[] | null>(null);
  const [toDecide, setToDecide] = useState<PurchaseRequest[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Drops responses that arrive after this user's dashboard is gone.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Runs a call, applies its result, and shows any error without touching the rest. */
  const run = useCallback(async <T,>(call: () => Promise<T>, apply: (v: T) => void) => {
    try {
      const value = await call();
      if (alive.current) apply(value);
      return true;
    } catch (err) {
      if (alive.current) setError(err);
      return false;
    }
  }, []);

  const loadMine = useCallback(() => run(api.getMine, setMine), [api, run]);
  const loadToDecide = useCallback(() => run(api.getToDecide, setToDecide), [api, run]);

  useEffect(() => {
    void run(api.getMe, setMe);
    void run(api.getSuppliers, setSuppliers);
    void loadMine();
  }, [api, run, loadMine]);

  const isApprover = me?.user.role === 'approver';
  useEffect(() => {
    if (isApprover) void loadToDecide();
  }, [isApprover, loadToDecide]);

  async function act<T>(call: () => Promise<T>, after: () => Promise<unknown>) {
    setError(null);
    if (await run(call, () => undefined)) await after();
  }

  const submit = (id: string) => act(() => api.submit(id), loadMine);
  const decide = (id: string, input: DecideInput) =>
    act(
      () => api.decide(id, input),
      () => Promise.all([loadToDecide(), loadMine()]),
    );
  const create = async (input: Parameters<typeof api.createRequest>[0]) => {
    setError(null);
    if (
      await run(
        () => api.createRequest(input),
        () => undefined,
      )
    ) {
      setFormOpen(false);
      await loadMine();
    }
  };

  return (
    <>
      <header>
        {picker}
        {me && (
          <p className="identity">
            <strong>{me.user.name}</strong> · {me.tenant.name}
          </p>
        )}
      </header>
      <main>
        <h1>Levelpath Demo</h1>
        <ErrorAlert error={error} />
        <section aria-labelledby="purchase-requests-heading">
          <h2 id="purchase-requests-heading">Purchase requests</h2>
          {formOpen && (
            <NewRequestForm
              suppliers={suppliers}
              onCreate={create}
              // Not through `run`: a failed suggestion is the form's note, never the ErrorAlert.
              onSuggest={(description) => api.suggest(description)}
              onCancel={() => setFormOpen(false)}
            />
          )}
          {mine && <RequestList requests={mine} onSubmit={(id) => void submit(id)} />}
          {!formOpen && (
            <button type="button" onClick={() => setFormOpen(true)}>
              New request
            </button>
          )}
        </section>
        {isApprover && toDecide && (
          <DecisionQueue requests={toDecide} onDecide={(id, input) => void decide(id, input)} />
        )}
      </main>
    </>
  );
}

export function App() {
  const year = new Date().getFullYear();
  const [userId, setUserId] = useState<string | null>(loadUserId);

  function pick(id: string) {
    saveUserId(id);
    setUserId(id);
  }
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  }
  const picker = (
    <>
      <UserPicker userId={userId} onChange={pick} />
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </>
  );

  return (
    <>
      {userId ? (
        <Dashboard key={userId} userId={userId} picker={picker} />
      ) : (
        <>
          <header>{picker}</header>
          <main>
            <h1>Levelpath Demo</h1>
            <p className="empty-state">Pick a user above to see purchase requests.</p>
          </main>
        </>
      )}
      <footer>{`Levelpath Demo · ${year}`}</footer>
    </>
  );
}
