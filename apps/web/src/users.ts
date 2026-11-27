// The four seeded users (db/seed.sql). A development stub, not a login.
export const USERS = [
  {
    id: 'a0000000-0000-4000-8000-000000000101',
    name: 'Alice',
    company: 'Acme Corp',
    role: 'requester',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000102',
    name: 'Amir',
    company: 'Acme Corp',
    role: 'approver',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000101',
    name: 'Bella',
    company: 'Globex Corp',
    role: 'requester',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000102',
    name: 'Boris',
    company: 'Globex Corp',
    role: 'approver',
  },
] as const;

const KEY = 'levelpath.userId';

export function loadUserId(): string | null {
  try {
    const id = localStorage.getItem(KEY);
    return USERS.some((u) => u.id === id) ? id : null;
  } catch (err) {
    console.warn('users: could not read the stored user', err);
    return null;
  }
}

export function saveUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch (err) {
    console.warn('users: could not store the user', err);
  }
}
