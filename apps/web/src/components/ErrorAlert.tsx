import { ApiRequestError } from '../api';

export function errorMessage(err: unknown): { message: string; issues: string[] } {
  if (err instanceof ApiRequestError) {
    if (err.status === 401) {
      return { message: 'Unknown user. Please pick a user from the list above.', issues: [] };
    }
    return { message: err.message, issues: err.issues.map((i) => `${i.path}: ${i.message}`) };
  }
  console.error('unexpected error', err);
  return { message: 'Something went wrong.', issues: [] };
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (error === null) return null;
  const { message, issues } = errorMessage(error);
  return (
    <div role="alert" className="error-alert">
      <p>{message}</p>
      {issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
