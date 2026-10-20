import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { initials } from "../format.js";

export default function ShareDialog({ doc, shares, onSharesChange, onClose }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    api.users().then((r) => setDirectory(r.users)).catch(() => {});
    inputRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestions = directory.filter((u) => !shares.some((s) => s.id === u.id));

  async function grant(targetEmail, targetRole) {
    setError("");
    setBusy(true);
    try {
      const res = await api.share(doc.id, targetEmail, targetRole);
      onSharesChange(res.shares);
      setEmail("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(person) {
    setError("");
    try {
      const res = await api.unshare(doc.id, person.id);
      onSharesChange(res.shares);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="modal-head">
          <h2 id="share-title">Share “{doc.title}”</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form
          className="share-form"
          onSubmit={(e) => {
            e.preventDefault();
            grant(email, role);
          }}
        >
          <input
            ref={inputRef}
            type="email"
            list="share-suggestions"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Add people by email"
            aria-label="Email of person to share with"
            required
          />
          <datalist id="share-suggestions">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Permission">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn primary" disabled={busy || !email.trim()}>
            Share
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <h3 className="modal-sub">People with access</h3>
        <ul className="people">
          <li>
            <span className="avatar">{initials(doc.owner.name)}</span>
            <span className="person-info">
              <strong>{doc.owner.name}</strong>
              <span className="muted small">{doc.owner.email}</span>
            </span>
            <span className="muted small">Owner</span>
          </li>
          {shares.map((p) => (
            <li key={p.id}>
              <span className="avatar">{initials(p.name)}</span>
              <span className="person-info">
                <strong>{p.name}</strong>
                <span className="muted small">{p.email}</span>
              </span>
              <select
                value={p.role}
                aria-label={`Permission for ${p.name}`}
                onChange={(e) => grant(p.email, e.target.value)}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button className="btn ghost small danger" onClick={() => revoke(p)} aria-label={`Remove ${p.name}`}>
                Remove
              </button>
            </li>
          ))}
          {shares.length === 0 && <li className="muted small">Only you can see this document.</li>}
        </ul>
      </div>
    </div>
  );
}
