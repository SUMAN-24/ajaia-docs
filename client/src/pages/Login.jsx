import { useState } from "react";
import { useAuth } from "../App.jsx";
import Logo from "../components/Logo.jsx";

const DEMO_PASSWORD = "password123";
const DEMO_USERS = [
  { name: "Alice Anderson", email: "alice@example.com", note: "owns the sample doc" },
  { name: "Bob Brown", email: "bob@example.com", note: "has editor access to it" },
  { name: "Carol Chen", email: "carol@example.com", note: "has no access yet" },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <Logo />
        <h1>Sign in</h1>
        <p className="muted">A lightweight collaborative document editor.</p>

        <form onSubmit={submit} noValidate>
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary block" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="demo-accounts">
          <h2>Demo accounts</h2>
          <p className="muted small">
            Click one to fill the form. Password for all: <code>{DEMO_PASSWORD}</code>
          </p>
          <ul>
            {DEMO_USERS.map((u) => (
              <li key={u.email}>
                <button
                  type="button"
                  className="demo-user"
                  onClick={() => {
                    setEmail(u.email);
                    setPassword(DEMO_PASSWORD);
                    setError("");
                  }}
                >
                  <strong>{u.name}</strong>
                  <span>{u.email}</span>
                  <em>{u.note}</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
