# AI workflow note

## Tools used

- **Claude Code** (Claude Sonnet 5.5) in the Claude desktop app: planning, scaffolding, writing server/client code and tests, running them, and debugging.
- The app's **built-in browser pane**, driven by Claude, to click through the running app (login, edit, share, upload) instead of trusting that the code "looks right".
- No code-completion plugins or other generators. Dependencies were chosen by me/the assistant from well-known libraries (TipTap, Express, better-sqlite3, mammoth, marked, sanitize-html), not generated.

## Where AI materially sped things up

- **Boilerplate with real surface area:** the Express routes, SQLite schema, multipart upload handling, and the React pages/CSS came together in one pass each. That freed time for the parts that need judgment (access rules, concurrency, sanitisation).
- **Test authoring:** the sharing matrix, upload edge cases (including generating a real `.docx` in-memory with JSZip as a fixture) and XSS cases were written alongside the code rather than after.
- **Driving the browser:** a scripted pass through the whole flow surfaced bugs that unit tests could not (below).

## What I changed or rejected

| AI output | What I did |
| --- | --- |
| Editor effect called `editor.setEditable(canEdit)` on mount. | **Found in the browser pass:** TipTap's `setEditable` emits an `update` by default, so merely *opening* a doc queued a save. A viewer saw a bogus "you no longer have edit access" toast; an editor would have bumped the version on every open and caused false conflicts. Fixed with `setEditable(canEdit, false)` plus a "HTML actually changed" guard in `onUpdate`. |
| List snippets stripped tags naively. | **Found in a screenshot:** `<h2>Roadmap</h2><p>Notes</p>` rendered as "RoadmapNotes". Fixed (block boundaries → spaces) and added a regression test. |
| Live-update polling ran on a timer only. | While testing "Carol sees Alice's edit", nothing happened: the browser pane was a hidden page and polling (correctly) pauses when hidden. Kept the pause (saves requests) and added a `visibilitychange` catch-up. |
| A stray no-op line (`res.cookie?.call;`) in the login route. | Caught on re-read; removed. |
| `node --test test/` in the test script. | Failed on Node 22 (it treats the path as a module); switched to a glob. |
| Dockerfile ran as `USER node`. | Removed: platform-mounted volumes (Render disks) are root-owned and a non-root user can't create the SQLite file. Commented why. |
| Dockerfile ran `npm ci --omit=dev` in a slim image. | **Failed on the first real Render deploy** (I couldn't build Docker locally): `better-sqlite3` is native, no prebuilt binary was fetched, and the slim image had no Python/compiler for the `node-gyp` fallback. Fixed with a dedicated deps stage that has `python3 make g++`; the runtime image copies the built `node_modules`. |
| Suggestions I considered and **rejected** | WebSockets/Yjs real-time co-editing (high cost, easy to get subtly wrong in the timebox) in favour of optimistic concurrency + polling; a JSON document format (HTML is simpler for import and good enough); a full auth system (seeded accounts meet the brief). Each is listed in ARCHITECTURE.md as a next step. |

## How I verified correctness, UX and reliability

1. **Automated:** 16 server tests (auth, CRUD, formatting round-trip, validation, XSS, 409 conflicts, every cell of the access matrix, all upload paths and rejections) and 5 client tests. All pass: `npm test`.
2. **Manual end-to-end in a real browser,** as three different users: create → rename → bold/heading/underline/bullets → reload → share as viewer → viewer is read-only → role changes (viewer↔editor) and revocation propagate to an already-open page → upload `.md` → import-into-draft → unsupported file shows a clear error.
3. **Read the diff critically:** access logic is concentrated in one function (`resolveAccess`) so it can be reviewed in one place; sanitisation happens on the server, never trusting client HTML.
4. **Reading the output, not just exit codes:** several bugs above were only visible by looking at screenshots/DOM state rather than by a green test run.

## What is *not* verified

- The **Docker image was never built locally** (Docker wasn't installed). The first Render build failed on the native-module issue above; after the Dockerfile fix it built and deployed, and I smoke-tested the live site (health check, login over HTTPS with the Secure cookie, document list). The full UI walkthrough and the automated tests were run natively with Node 22, **not** against the deployed container, so deployed-only behaviour (e.g. the ephemeral free-tier disk resetting data on restart) is untested beyond that smoke test.
- Cross-browser behaviour (tested in Chromium only) and screen-reader use.
- Keystroke-level behaviour of Markdown input rules (the test driver inserts text in bulk, which bypasses ProseMirror input rules); toolbar and keyboard-shortcut formatting were verified.
