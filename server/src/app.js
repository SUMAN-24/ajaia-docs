import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import express from "express";
import multer from "multer";
import sanitizeHtml from "sanitize-html";
import { ImportError, MAX_UPLOAD_BYTES, parseUpload } from "./importer.js";
import { sanitizeContent } from "./sanitize.js";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TITLE = 200;
// Compared against when the email is unknown so response time doesn't leak which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );
}

function cleanTitle(value, fallback = "Untitled document") {
  const title = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return title || fallback;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

export function createApp(db, { clientDir } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  /* ------------------------------ data access ------------------------------ */

  const q = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT id, name, email FROM users WHERE id = ?"),
    allUsers: db.prepare("SELECT id, name, email FROM users ORDER BY name"),
    createSession: db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"),
    sessionUser: db.prepare(
      `SELECT u.id, u.name, u.email, s.created_at FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
    insertDoc: db.prepare(
      "INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ),
    docById: db.prepare(
      `SELECT d.*, o.name AS owner_name, o.email AS owner_email FROM documents d
       JOIN users o ON o.id = d.owner_id WHERE d.id = ?`,
    ),
    shareFor: db.prepare("SELECT role FROM shares WHERE document_id = ? AND user_id = ?"),
    owned: db.prepare("SELECT * FROM documents WHERE owner_id = ? ORDER BY updated_at DESC"),
    sharedWith: db.prepare(
      `SELECT d.*, o.name AS owner_name, o.email AS owner_email, s.role AS role
       FROM shares s JOIN documents d ON d.id = s.document_id JOIN users o ON o.id = d.owner_id
       WHERE s.user_id = ? ORDER BY d.updated_at DESC`,
    ),
    sharesOf: db.prepare(
      `SELECT u.id, u.name, u.email, s.role FROM shares s JOIN users u ON u.id = s.user_id
       WHERE s.document_id = ? ORDER BY u.name`,
    ),
    upsertShare: db.prepare(
      `INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`,
    ),
    deleteShare: db.prepare("DELETE FROM shares WHERE document_id = ? AND user_id = ?"),
    deleteDoc: db.prepare("DELETE FROM documents WHERE id = ?"),
    // Guarded by version so two concurrent writers can't both succeed.
    updateDoc: db.prepare(
      `UPDATE documents SET title = ?, content = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    ),
  };

  /** Returns { doc, role } where role is owner | editor | viewer. 404s (not 403s) to avoid leaking existence. */
  function resolveAccess(docId, user) {
    const doc = Number.isInteger(docId) ? q.docById.get(docId) : undefined;
    if (!doc) throw new HttpError(404, "Document not found");
    if (doc.owner_id === user.id) return { doc, role: "owner" };
    const share = q.shareFor.get(doc.id, user.id);
    if (!share) throw new HttpError(404, "Document not found");
    return { doc, role: share.role };
  }

  const canEdit = (role) => role === "owner" || role === "editor";

  // Block boundaries become spaces first, otherwise "<h2>A</h2><p>B</p>" would read "AB".
  const snippet = (html) =>
    sanitizeHtml(html.replace(/<\/(p|h[1-6]|li|blockquote|pre)>|<br\s*\/?>/gi, " "), {
      allowedTags: [],
      allowedAttributes: {},
    })
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

  function serializeSummary(row, role, owner) {
    return {
      id: row.id,
      title: row.title,
      snippet: snippet(row.content),
      role,
      owner: owner ?? { id: row.owner_id, name: row.owner_name, email: row.owner_email },
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  }

  function serializeDoc(doc, role) {
    const out = {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      role,
      owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
    if (role === "owner") out.shares = q.sharesOf.all(doc.id);
    return out;
  }

  const docId = (req) => Number.parseInt(req.params.id, 10);

  /* ------------------------------- middleware ------------------------------ */

  function auth(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const row = token && q.sessionUser.get(token);
    if (!row || Date.now() - row.created_at > SESSION_TTL_MS) {
      return next(new HttpError(401, "Please sign in"));
    }
    req.user = { id: row.id, name: row.name, email: row.email };
    req.token = token;
    next();
  }

  /* ---------------------------------- auth --------------------------------- */

  const api = express.Router();

  api.get("/health", (_req, res) => res.json({ ok: true }));

  api.post("/auth/login", (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!email || !password) throw new HttpError(400, "Email and password are required");
    const user = q.userByEmail.get(email);
    const ok = bcrypt.compareSync(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, "Incorrect email or password");
    const token = crypto.randomBytes(32).toString("hex");
    q.createSession.run(token, user.id, Date.now());
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.json({ user: publicUser(user) });
  });

  api.post("/auth/logout", auth, (req, res) => {
    q.deleteSession.run(req.token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  api.get("/auth/me", auth, (req, res) => res.json({ user: req.user }));

  // Directory of users, used by the Share dialog for suggestions (fine for an internal tool).
  api.get("/users", auth, (req, res) => {
    res.json({ users: q.allUsers.all().filter((u) => u.id !== req.user.id) });
  });

  /* -------------------------------- documents ------------------------------ */

  api.get("/documents", auth, (req, res) => {
    const me = req.user;
    res.json({
      owned: q.owned.all(me.id).map((d) => serializeSummary(d, "owner", me)),
      shared: q.sharedWith.all(me.id).map((d) => serializeSummary(d, d.role)),
    });
  });

  api.post("/documents", auth, (req, res) => {
    const now = Date.now();
    const title = cleanTitle(req.body?.title);
    const content = sanitizeContent(req.body?.content);
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, content, now, now);
    res.status(201).json(serializeDoc(q.docById.get(lastInsertRowid), "owner"));
  });

  // Declared before "/documents/:id" so "import" isn't treated as an id.
  api.post("/documents/import", auth, upload.single("file"), async (req, res) => {
    const { title, html } = await parseUpload(req.file);
    const now = Date.now();
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, html, now, now);
    res.status(201).json(serializeDoc(q.docById.get(lastInsertRowid), "owner"));
  });

  // Parse-only: lets the editor insert a file's content into an existing draft.
  api.post("/import/parse", auth, upload.single("file"), async (req, res) => {
    res.json(await parseUpload(req.file));
  });

  api.get("/documents/:id", auth, (req, res) => {
    const { doc, role } = resolveAccess(docId(req), req.user);
    res.json(serializeDoc(doc, role));
  });

  api.put("/documents/:id", auth, (req, res) => {
    const { doc, role } = resolveAccess(docId(req), req.user);
    if (!canEdit(role)) throw new HttpError(403, "You have view-only access to this document");

    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) {
      throw new HttpError(400, "Nothing to update");
    }
    if (body.content !== undefined && typeof body.content !== "string") {
      throw new HttpError(400, "content must be a string of HTML");
    }
    if (body.title !== undefined && !String(body.title).trim()) {
      throw new HttpError(400, "Title cannot be empty");
    }

    // Optimistic concurrency: the client says which version it edited.
    const baseVersion = body.version ?? doc.version;
    const title = body.title !== undefined ? cleanTitle(body.title) : doc.title;
    const content = body.content !== undefined ? sanitizeContent(body.content) : doc.content;
    const result = q.updateDoc.run(title, content, Date.now(), doc.id, baseVersion);
    if (result.changes === 0) {
      throw new HttpError(409, "This document was changed by someone else", {
        current: serializeDoc(q.docById.get(doc.id), role),
      });
    }
    res.json(serializeDoc(q.docById.get(doc.id), role));
  });

  api.delete("/documents/:id", auth, (req, res) => {
    const { doc, role } = resolveAccess(docId(req), req.user);
    if (role !== "owner") throw new HttpError(403, "Only the owner can delete a document");
    q.deleteDoc.run(doc.id);
    res.json({ ok: true });
  });

  /* --------------------------------- sharing ------------------------------- */

  api.post("/documents/:id/shares", auth, (req, res) => {
    const { doc, role } = resolveAccess(docId(req), req.user);
    if (role !== "owner") throw new HttpError(403, "Only the owner can share this document");

    const email = String(req.body?.email ?? "").trim();
    const shareRole = req.body?.role ?? "viewer";
    if (!email) throw new HttpError(400, "Enter the email of the person to share with");
    if (!["viewer", "editor"].includes(shareRole)) throw new HttpError(400, "Role must be viewer or editor");

    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user found with email ${email}`);
    if (target.id === req.user.id) throw new HttpError(400, "You already own this document");

    q.upsertShare.run(doc.id, target.id, shareRole, Date.now());
    res.status(201).json({ shares: q.sharesOf.all(doc.id) });
  });

  api.delete("/documents/:id/shares/:userId", auth, (req, res) => {
    const { doc, role } = resolveAccess(docId(req), req.user);
    const userId = Number.parseInt(req.params.userId, 10);
    // Owners can revoke anyone; a collaborator can remove themselves.
    if (role !== "owner" && userId !== req.user.id) {
      throw new HttpError(403, "Only the owner can change who has access");
    }
    q.deleteShare.run(doc.id, userId);
    res.json({ shares: role === "owner" ? q.sharesOf.all(doc.id) : [] });
  });

  app.use("/api", api);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  /* ---------------------------- static client (prod) ----------------------- */

  const dist = clientDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  /* ------------------------------- error handler --------------------------- */

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof ImportError) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      return res
        .status(tooBig ? 413 : 400)
        .json({ error: tooBig ? `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` : err.message });
    }
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side" });
  });

  return app;
}
