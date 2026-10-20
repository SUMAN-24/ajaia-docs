import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useToast } from "../App.jsx";
import { api } from "../api.js";
import Logo from "../components/Logo.jsx";
import UserMenu from "../components/UserMenu.jsx";
import { MAX_UPLOAD_MB, SUPPORTED_UPLOADS, roleLabel, timeAgo, validateUpload } from "../format.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "owned", label: "Owned by me" },
  { id: "shared", label: "Shared with me" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [docs, setDocs] = useState(null); // { owned, shared }
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setDocs(await api.listDocs());
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!docs) return [];
    const all = [...docs.owned, ...docs.shared].sort((a, b) => b.updatedAt - a.updatedAt);
    const byFilter = all.filter((d) =>
      filter === "owned" ? d.role === "owner" : filter === "shared" ? d.role !== "owner" : true,
    );
    const needle = query.trim().toLowerCase();
    return needle
      ? byFilter.filter((d) => d.title.toLowerCase().includes(needle) || d.snippet.toLowerCase().includes(needle))
      : byFilter;
  }, [docs, filter, query]);

  async function createDoc() {
    setBusy("create");
    try {
      const doc = await api.createDoc("Untitled document");
      navigate(`/docs/${doc.id}`);
    } catch (err) {
      toast(err.message, "error");
      setBusy("");
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const problem = validateUpload(file);
    if (problem) return toast(problem, "error");

    setBusy("upload");
    try {
      const doc = await api.importDoc(file);
      toast(`Imported "${doc.title}"`, "success");
      navigate(`/docs/${doc.id}`);
    } catch (err) {
      toast(err.message, "error");
      setBusy("");
    }
  }

  async function remove(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This also removes access for everyone it's shared with.`)) return;
    try {
      await api.deleteDoc(doc.id);
      setDocs((d) => ({ ...d, owned: d.owned.filter((x) => x.id !== doc.id) }));
      toast("Document deleted", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const counts = docs && { all: docs.owned.length + docs.shared.length, owned: docs.owned.length, shared: docs.shared.length };

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Ajaia Docs home">
          <Logo small />
        </Link>
        <UserMenu />
      </header>

      <main className="dashboard">
        <section className="hero">
          <div>
            <h1>Hi {user.name.split(" ")[0]}, what are we writing today?</h1>
            <p className="muted">
              Upload accepts <strong>{SUPPORTED_UPLOADS.join(", ")}</strong> files up to {MAX_UPLOAD_MB} MB and turns them into
              editable documents.
            </p>
          </div>
          <div className="hero-actions">
            <button className="btn primary" onClick={createDoc} disabled={!!busy}>
              {busy === "create" ? "Creating…" : "+ New document"}
            </button>
            <button className="btn" onClick={() => fileInput.current.click()} disabled={!!busy}>
              {busy === "upload" ? "Importing…" : "Upload file"}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept={SUPPORTED_UPLOADS.join(",")}
              onChange={onFile}
              aria-label="Upload a document file"
            />
          </div>
        </section>

        <div className="list-controls">
          <div className="chips" role="tablist" aria-label="Filter documents">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`chip ${filter === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {counts && <span className="count">{counts[f.id]}</span>}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="search"
            placeholder="Search documents"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loadError && (
          <div className="banner error" role="alert">
            {loadError} <button className="link" onClick={load}>Retry</button>
          </div>
        )}
        {!docs && !loadError && <p className="muted">Loading documents…</p>}

        {docs && rows.length === 0 && (
          <div className="empty">
            {docs.owned.length + docs.shared.length === 0 ? (
              <>
                <h2>No documents yet</h2>
                <p className="muted">Create a new one, or upload a file to get started.</p>
              </>
            ) : (
              <p className="muted">No documents match this view.</p>
            )}
          </div>
        )}

        <ul className="doc-list">
          {rows.map((d) => {
            const mine = d.role === "owner";
            return (
              <li key={d.id} className="doc-row">
                <Link to={`/docs/${d.id}`} className="doc-main">
                  <span className="doc-icon" aria-hidden="true">
                    📄
                  </span>
                  <span className="doc-text">
                    <span className="doc-title">{d.title}</span>
                    <span className="doc-snippet">{d.snippet || "Empty document"}</span>
                  </span>
                </Link>
                <div className="doc-meta">
                  <span className={`badge ${mine ? "badge-owner" : "badge-shared"}`}>
                    {mine ? "Owned by you" : `Shared · ${roleLabel(d.role)}`}
                  </span>
                  <span className="muted small">
                    {mine ? "You" : d.owner.name} · {timeAgo(d.updatedAt)}
                  </span>
                </div>
                {mine && (
                  <button className="btn ghost small danger" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}>
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
