import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);

CREATE TABLE IF NOT EXISTS shares (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

export const DEMO_PASSWORD = "password123";

const DEMO_USERS = [
  { email: "alice@example.com", name: "Alice Anderson" },
  { email: "bob@example.com", name: "Bob Brown" },
  { email: "carol@example.com", name: "Carol Chen" },
];

const WELCOME_HTML = `<h1>Welcome to Ajaia Docs</h1>
<p>This is a <strong>sample document</strong> owned by Alice and shared with Bob as an <em>editor</em>.</p>
<h2>Try these</h2>
<ul>
  <li>Format text with the toolbar: <strong>bold</strong>, <em>italic</em>, <u>underline</u></li>
  <li>Switch headings and lists</li>
  <li>Sign in as Bob in another browser window to see the shared view</li>
</ul>
<ol>
  <li>Upload a <code>.txt</code>, <code>.md</code> or <code>.docx</code> from the dashboard</li>
  <li>Click <em>Share</em> to grant another user access</li>
</ol>`;

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDb(file = process.env.DB_PATH || "./data/docs.db") {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/** Idempotent: creates demo users and a sample shared doc only on an empty database. */
export function seed(db) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if (n > 0) return;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const now = Date.now();
  const insertUser = db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)");
  const ids = DEMO_USERS.map((u) => insertUser.run(u.email, u.name, hash).lastInsertRowid);
  const doc = db
    .prepare("INSERT INTO documents (owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(ids[0], "Welcome to Ajaia Docs", WELCOME_HTML, now, now);
  db.prepare("INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, 'editor', ?)").run(
    doc.lastInsertRowid,
    ids[1],
    now,
  );
}
