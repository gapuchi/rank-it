import type { User } from "../../core/types";

interface AppHeaderProps {
  readonly users: readonly User[];
  readonly currentUserId: string | null;
  readonly onSelectUser: (userId: string) => void;
  readonly onCreateUser: () => void;
}

export function AppHeader({
  users,
  currentUserId,
  onSelectUser,
  onCreateUser,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>rank-it</h1>
      <p>Rank the movies, shows, and games you have completed.</p>
      <div className="user-bar">
        <label htmlFor="user-select">Ranking as</label>
        <select
          id="user-select"
          aria-label="Current user"
          value={currentUserId ?? ""}
          onChange={(event) => onSelectUser(event.target.value)}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <button className="ghost" type="button" onClick={onCreateUser}>
          New user
        </button>
      </div>
    </header>
  );
}
