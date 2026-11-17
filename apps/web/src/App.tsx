import './App.css';

export function App() {
  return (
    <main>
      <h1>Levelpath Demo</h1>
      <section aria-labelledby="purchase-requests-heading">
        <h2 id="purchase-requests-heading">Purchase requests</h2>
        <div className="empty-state">
          <p>No purchase requests yet.</p>
          <p>Requesters will create purchase requests here.</p>
        </div>
        <button type="button" disabled>
          New request
        </button>
      </section>
    </main>
  );
}
