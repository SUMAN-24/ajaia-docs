# Architecture note

## The slice I chose to build

The brief is a Google Docs-lite in 4–6 hours. I treated "documents people can trust" as the core: a document you edit must save reliably, reopen with its formatting, and be visible to exactly the right people. I spent depth on those paths (autosave, conflict handling, access control, sanitised storage) and cut breadth (real-time co-editing, comments, history, export).

```
React SPA (Vite)  ──/api──▶  Express 5  ──▶  SQLite (better-sqlite3)
  TipTap editor               auth · access rules · import · sanitise
  autosave + poll             serves the built SPA in production
```

One deployable process: Express serves both `/api` and the built client, so there's no CORS, one URL to test, and one container to host.

## Key decisions and trade-offs

| Decision | Why | Cost / alternative |
| --- | --- | --- |
| **TipTap (ProseMirror)** for the editor | Real rich-text semantics (marks, lists, input rules, undo) without hand-rolling `contentEditable`, which is the classic time sink. | Bundle is ~215 KB gzipped; could be code-split. |
| **Store documents as HTML** | It's TipTap's native format, trivially round-trips, and makes `.md`/`.docx` import a plain "convert to HTML" step (`marked`, `mammoth`). | JSON (ProseMirror doc) is more future-proof for collaboration/diffing. Migration is mechanical. |
| **Sanitise on the server** (`sanitize-html` allow-list) | Content arrives from editors *and* imported files; the DB must never hold scripts/handlers, because other users render it. Client is not trusted. | Anything not on the allow-list (tables, images) is dropped on save. That's why the editor only offers what the allow-list permits. |
| **SQLite** | Zero-ops, transactional, reviewers need nothing installed. Schema uses foreign keys + a `CHECK` on roles. | Single-writer, file on local disk. Fine for this scope; swap to Postgres behind the same queries if needed. |
| **Seeded users + server-side sessions** | The brief allows mocked auth. Random 256-bit tokens in an HttpOnly, SameSite=Lax cookie (Secure in production), bcrypt hashes, constant-time-ish login for unknown emails. Real enough to make sharing meaningful. | No sign-up/reset flows. |
| **Roles: owner / editor / viewer** | Small step beyond "has access" that exercises real authorisation logic (read vs write vs manage). One function, `resolveAccess`, decides everything; routes then check `canEdit` / `role === "owner"`. | No groups, link sharing or per-folder inheritance. |
| **404 instead of 403 for unshared docs** | Don't leak that a document ID exists. | Slightly less specific error for legit users; the UI explains both cases. |
| **Optimistic concurrency (`version` column)** | Two people editing the same doc with last-write-wins silently loses work. `UPDATE … WHERE id=? AND version=?` makes the loser get `409` + the current copy; the UI offers *Load their version* or *Keep mine*. | Not a merge. For true concurrent editing you want CRDTs (Yjs). |
| **Polling (4 s) instead of WebSockets** | When you have nothing unsaved, the page pulls newer versions so sharing *feels* live and demonstrates the sharing model, for ~15 lines of code. It pauses in hidden tabs and refreshes on focus. | Latency and request volume; fine for tens of users, not thousands. |
| **Autosave (800 ms debounce) with serialised saves** | Docs apps shouldn't have a Save button. Only one request in flight; edits made meanwhile are batched into the next one; failures keep the unsaved patch and retry; closing the tab with unsaved work prompts. | — |

## Access model (the part most worth reviewing)

`server/src/app.js` → `resolveAccess(docId, user)` returns `{doc, role}` or throws 404:

| Action | owner | editor | viewer | no access |
| --- | :-: | :-: | :-: | :-: |
| Read | ✅ | ✅ | ✅ | 404 |
| Edit content / rename | ✅ | ✅ | 403 | 404 |
| Share / change roles / revoke others | ✅ | 403 | 403 | 404 |
| Remove *self* from a share | n/a | ✅ | ✅ | 404 |
| Delete document | ✅ | 403 | 403 | 404 |

The share list is only returned to the owner. Every row of this table has a test in `server/test/api.test.js`.

## Testing

- **Server (16 tests, `node:test` + `supertest`, in-memory SQLite):** auth, create/rename/edit/reopen with formatting intact, validation, XSS stripping, 409 conflict, the whole sharing matrix above (including upgrade and revoke), and upload (`.txt`, `.md`, a real generated `.docx`, parse-only, and unsupported/empty/corrupt/oversized rejections).
- **Client (5 tests, vitest):** upload validation, relative-time formatting, labels.
- **Manual browser pass** of: login → create → rename → format → reload → share → viewer read-only → live update → upload → import-into-draft → error toasts.

Not covered: automated UI/E2E tests of the editor (the highest-value next test investment).

## Known limitations

- Concurrent typing in the same doc is *detected*, not merged (see above).
- The toolbar/editor aren't tested with screen readers; basics (labels, `aria-pressed`, roles, focus management in the dialog) are in place.
- On free hosting with an ephemeral disk, data resets on redeploy (demo data is re-seeded).
- The people directory (`GET /users`) lists every user for share autocomplete — acceptable for an internal tool, not for a multi-tenant product.
