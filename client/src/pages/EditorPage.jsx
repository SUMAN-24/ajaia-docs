import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../App.jsx";
import { api } from "../api.js";
import Logo from "../components/Logo.jsx";
import ShareDialog from "../components/ShareDialog.jsx";
import Toolbar from "../components/Toolbar.jsx";
import UserMenu from "../components/UserMenu.jsx";
import { SUPPORTED_UPLOADS, roleLabel, validateUpload } from "../format.js";

const AUTOSAVE_MS = 800;
const POLL_MS = 4000;

export default function EditorPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDoc(null);
    setError("");
    api
      .getDoc(id)
      .then(setDoc)
      .catch((err) => setError(err.status === 404 ? "This document doesn't exist, or you don't have access to it." : err.message));
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <header className="topbar">
          <Link to="/" className="brand">
            <Logo small />
          </Link>
          <UserMenu />
        </header>
        <main className="dashboard empty">
          <h2>Can't open this document</h2>
          <p className="muted">{error}</p>
          <Link to="/" className="btn primary">
            Back to documents
          </Link>
        </main>
      </div>
    );
  }
  if (!doc) return <div className="splash">Loading document…</div>;
  return <DocumentEditor key={doc.id} initial={doc} />;
}

const STATUS_TEXT = {
  saved: "All changes saved",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  error: "Couldn't save — retrying",
  conflict: "Out of sync",
  readonly: "View only",
};

function DocumentEditor({ initial }) {
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [title, setTitle] = useState(initial.title);
  const [role, setRole] = useState(initial.role);
  const [shares, setShares] = useState(initial.shares ?? []);
  const [status, setStatus] = useState("saved");
  const [conflict, setConflict] = useState(null); // server copy that beat us
  const [showShare, setShowShare] = useState(false);

  const canEdit = role === "owner" || role === "editor";

  // Mutable save machinery lives in refs so timers/handlers never see stale state.
  const versionRef = useRef(initial.version);
  const pending = useRef({}); // fields changed since the last successful save
  const inFlight = useRef(false);
  const timer = useRef(null);
  const savedTitle = useRef(initial.title);
  const statusRef = useRef("saved");
  const editorRef = useRef(null);
  const lastHtml = useRef(null); // HTML as of the last user edit or remote apply

  const updateStatus = useCallback((s) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current || Object.keys(pending.current).length === 0) return;

    const patch = pending.current;
    pending.current = {};
    inFlight.current = true;
    updateStatus("saving");
    try {
      const res = await api.updateDoc(initial.id, { ...patch, version: versionRef.current });
      versionRef.current = res.version;
      if (patch.title !== undefined) savedTitle.current = res.title;
    } catch (err) {
      pending.current = { ...patch, ...pending.current }; // keep unsaved work
      inFlight.current = false;
      if (err.status === 409) {
        setConflict(err.body.current);
        updateStatus("conflict");
      } else if (err.status === 403 || err.status === 404) {
        updateStatus("error");
        toast(err.status === 403 ? "You no longer have edit access to this document." : err.message, "error");
        setRole("viewer");
      } else {
        updateStatus("error");
        timer.current = setTimeout(flush, 4000);
      }
      return;
    }
    inFlight.current = false;
    if (Object.keys(pending.current).length > 0) flush();
    else updateStatus("saved");
  }, [initial.id, toast, updateStatus]);

  const queueSave = useCallback(
    (fields) => {
      pending.current = { ...pending.current, ...fields };
      if (statusRef.current === "conflict") return; // wait for the user's decision
      updateStatus("dirty");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
    [flush, updateStatus],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: initial.content,
    editable: initial.role !== "viewer",
    editorProps: { attributes: { class: "prose", "aria-label": "Document body" } },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      if (html === lastHtml.current) return; // selection/normalisation churn, not a real edit
      lastHtml.current = html;
      queueSave({ content: html });
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    // emitUpdate=false: toggling editability must never look like a user edit.
    editor.setEditable(canEdit, false);
    lastHtml.current ??= editor.getHTML();
  }, [editor, canEdit]);

  /* Apply a server copy to the local editor without echoing it back as an edit. */
  const applyRemote = useCallback((remote) => {
    editorRef.current?.commands.setContent(remote.content, { emitUpdate: false });
    lastHtml.current = editorRef.current?.getHTML() ?? null;
    setTitle(remote.title);
    setRole(remote.role);
    if (remote.shares) setShares(remote.shares);
    savedTitle.current = remote.title;
    versionRef.current = remote.version;
  }, []);

  /* Light-weight "live" collaboration: pull newer versions while we have nothing unsaved. */
  useEffect(() => {
    const poll = async () => {
      if (document.hidden || statusRef.current === "dirty" || inFlight.current) return;
      if (statusRef.current === "conflict" || Object.keys(pending.current).length) return;
      try {
        const remote = await api.getDoc(initial.id);
        // Re-check: the user may have typed while the request was in flight.
        if (Object.keys(pending.current).length || inFlight.current) return;
        if (remote.role !== role) setRole(remote.role);
        if (remote.version > versionRef.current) {
          applyRemote(remote);
          toast("Updated with the latest changes", "info");
        }
      } catch (err) {
        if (err.status === 404) {
          toast("You no longer have access to that document", "error");
          navigate("/");
        }
      }
    };
    const t = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll); // catch up as soon as the tab is focused again
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [initial.id, role, applyRemote, toast, navigate]);

  /* Don't lose work on tab close / route change. */
  useEffect(() => {
    const warn = (e) => {
      if (Object.keys(pending.current).length || inFlight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flush(); // best-effort save when navigating within the app
    };
  }, [flush]);

  /* ------------------------------ handlers ------------------------------ */

  function onTitleChange(e) {
    setTitle(e.target.value);
    if (e.target.value.trim()) queueSave({ title: e.target.value });
    else delete pending.current.title;
  }

  function onTitleBlur() {
    if (!title.trim()) {
      setTitle(savedTitle.current); // never leave a document nameless
      delete pending.current.title;
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validateUpload(file);
    if (problem) return toast(problem, "error");
    try {
      const { html } = await api.parseFile(file);
      editor.chain().focus().insertContent(html).run();
      toast(`Inserted contents of ${file.name}`, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function loadLatest() {
    pending.current = {};
    applyRemote(conflict);
    setConflict(null);
    updateStatus("saved");
  }

  function keepMine() {
    versionRef.current = conflict.version; // rebase our edits on top of the newer server copy
    setConflict(null);
    updateStatus("dirty");
    flush();
  }

  const isOwner = role === "owner";
  const shownStatus = !canEdit ? "readonly" : status;

  return (
    <div className="page editor-page">
      <header className="topbar editor-top">
        <Link to="/" className="brand" aria-label="Back to documents">
          <Logo small />
        </Link>
        <div className="title-wrap">
          <input
            className="title-input"
            value={title}
            onChange={onTitleChange}
            onBlur={onTitleBlur}
            readOnly={!canEdit}
            maxLength={200}
            aria-label="Document title"
            placeholder="Untitled document"
          />
          <span className={`save-status status-${shownStatus}`} aria-live="polite">
            {STATUS_TEXT[shownStatus]}
          </span>
        </div>
        <div className="top-actions">
          {isOwner ? (
            <button className="btn primary" onClick={() => setShowShare(true)}>
              Share{shares.length > 0 && <span className="count light">{shares.length}</span>}
            </button>
          ) : (
            <span className="badge badge-shared" title={`Owned by ${initial.owner.email}`}>
              Shared by {initial.owner.name} · {roleLabel(role)}
            </span>
          )}
          <UserMenu />
        </div>
      </header>

      {conflict && (
        <div className="banner warn" role="alert">
          <span>
            Someone else saved a newer version of this document. Your latest edits haven't been saved.
          </span>
          <span className="banner-actions">
            <button className="btn small" onClick={loadLatest}>
              Load their version
            </button>
            <button className="btn small primary" onClick={keepMine}>
              Keep mine (overwrite)
            </button>
          </span>
        </div>
      )}
      {!canEdit && (
        <div className="banner info">You have view-only access. Ask {initial.owner.name} for edit access to make changes.</div>
      )}

      {editor && <Toolbar editor={editor} disabled={!canEdit} onImport={() => fileInput.current.click()} />}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={SUPPORTED_UPLOADS.join(",")}
        onChange={onImportFile}
        aria-label="Import a file into this document"
      />

      <main className="canvas" onClick={() => canEdit && editor?.commands.focus()}>
        <article className="paper" onClick={(e) => e.stopPropagation()}>
          <EditorContent editor={editor} />
        </article>
      </main>

      {showShare && (
        <ShareDialog
          doc={{ id: initial.id, title, owner: initial.owner }}
          shares={shares}
          onSharesChange={setShares}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
