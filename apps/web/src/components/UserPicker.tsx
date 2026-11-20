import { USERS } from '../users';

export function UserPicker({
  userId,
  onChange,
}: {
  userId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="user-picker">
      <label htmlFor="user-picker">User</label>
      <select id="user-picker" value={userId ?? ''} onChange={(e) => onChange(e.target.value)}>
        {userId === null && (
          <option value="" disabled>
            Pick a user
          </option>
        )}
        {USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {`${u.name} (${u.company}, ${u.role})`}
          </option>
        ))}
      </select>
      <p className="note">Development stub, not a login: anyone can be anyone.</p>
    </div>
  );
}
