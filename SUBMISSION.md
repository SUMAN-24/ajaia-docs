# Submission: Ajaia Docs

## Live product

**URL:** `https://ajaia-docs-a7vi.onrender.com` (see "Deploying" below)
**Google Drive folder link:** `https://drive.google.com/drive/folders/1GK9cgipynvHV9Obvgqexdmy3gVV8PhqR?usp=sharing` (contains all materials)

**Reviewer credentials** (seeded; same password for all): `password123`

| User | Email | Role in the demo |
| --- | --- | --- |
| Alice Anderson | `alice@example.com` | Owns the sample doc |
| Bob Brown | `bob@example.com` | Editor on Alice's sample doc |
| Carol Chen | `carol@example.com` | No access yet; share to her to test |

Tip: use two browser profiles (or one normal + one private window) to see two users at once. A 2-minute review path is in [README.md](README.md#suggested-2-minute-review-path).

## What's included

| Path | Contents |
| --- | --- |
| `README.md` | Local setup, run, test, Docker, accounts, features, what works / is incomplete / next steps, API summary |
| `ARCHITECTURE.md` | Architecture note: what I prioritised and why, trade-offs, access model, testing |
| `AI_WORKFLOW.md` | AI tools used, where they helped, what I changed or rejected, how I verified |
| `SUBMISSION.md` | This file |
| `WALKTHROUGH_VIDEO_URL.txt` | Walkthrough video link plus the script outline |
| `docs/screenshots/` | Dashboard, editor and share-dialog screenshots |
| `client/` | React 19 + Vite SPA: `src/pages` (Login, Dashboard, EditorPage), `src/components` (Toolbar, ShareDialog, ...), `format.test.js` |
| `server/` | Express 5 API: `src/` (app, db, importer, sanitize, index), `test/api.test.js` |
| `Dockerfile`, `.dockerignore`, `render.yaml` | Single-container deployment (Render Blueprint) |
| `package.json` | Root convenience scripts (`setup`, `start`, `dev:*`, `test`) |

`node_modules/`, `client/dist/` and any `*.db` files are excluded from the folder (rebuilt by `npm run setup` / `npm start`).

## Honest status

**Working:** document create/rename/edit/save/reopen with rich text (bold, italic, underline, H1-H3, bulleted/numbered lists, quote, undo/redo); autosave with conflict handling; `.txt`/`.md`/`.docx` upload to a new document and import into an open draft; owner/editor/viewer sharing with owned-vs-shared distinction; SQLite persistence; validation and error handling; 16 server + 5 client automated tests (all passing).

**Not done / caveats**
- No real-time co-editing (conflicts are detected, not merged), no sign-up, version history, comments, export, tables or images. Rationale in ARCHITECTURE.md.
- On Render's free tier the disk is ephemeral: data resets on redeploy; seed data returns automatically.

**With another 2-4 hours:** Yjs real-time collaboration + presence, version history with restore, Markdown/PDF export, invite-by-email sign-up, Playwright E2E tests.

## Deploying (about 5 minutes)

1. Push this folder to a GitHub repo.
2. Render: **New + -> Blueprint** -> select the repo (it reads `render.yaml`). Free plan, Docker runtime.
3. When it's live, put the URL at the top of this file. Smoke test: open the URL, sign in as Alice, create a doc, refresh.

Any Docker host works the same way (Fly.io, Railway, ...): the container listens on `$PORT` (default 8080) and keeps its SQLite file at `$DB_PATH` (default `/data/docs.db`; mount a volume there to persist).
