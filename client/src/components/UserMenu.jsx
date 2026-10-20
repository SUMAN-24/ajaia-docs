import { useAuth } from "../App.jsx";
import { initials } from "../format.js";

export default function UserMenu() {
  const { user, logout } = useAuth();
  return (
    <div className="user-menu">
      <span className="avatar" title={user.email} aria-hidden="true">
        {initials(user.name)}
      </span>
      <span className="user-name">{user.name}</span>
      <button className="btn ghost small" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
