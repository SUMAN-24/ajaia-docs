import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import JSZip from "jszip";
import request from "supertest";
import { createApp } from "../src/app.js";
import { DEMO_PASSWORD, openDb, seed } from "../src/db.js";

async function login(app, email) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: DEMO_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${email}`);
  return agent;
}

async function makeDocx(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Ajaia Docs API", () => {
  let app, alice, bob, carol;

  before(async () => {
    const db = openDb(":memory:");
    seed(db);
    app = createApp(db, { clientDir: "/nonexistent" });
    [alice, bob, carol] = await Promise.all([
      login(app, "alice@example.com"),
      login(app, "bob@example.com"),
      login(app, "carol@example.com"),
    ]);
  });

  describe("auth", () => {
    it("rejects bad credentials and unauthenticated access", async () => {
      const bad = await request(app).post("/api/auth/login").send({ email: "alice@example.com", password: "nope" });
      assert.equal(bad.status, 401);
      const anon = await request(app).get("/api/documents");
      assert.equal(anon.status, 401);
    });

    it("returns the current user", async () => {
      const me = await alice.get("/api/auth/me");
      assert.equal(me.body.user.email, "alice@example.com");
    });
  });

  describe("documents: create, rename, edit, persist", () => {
    it("creates, renames, edits and re-reads a document with formatting intact", async () => {
      const created = await alice.post("/api/documents").send({ title: "Plan" });
      assert.equal(created.status, 201);
      const id = created.body.id;

      const html = "<h1>Heading</h1><p><strong>bold</strong> <em>it</em> <u>under</u></p><ul><li>one</li></ul>";
      const saved = await alice.put(`/api/documents/${id}`).send({ title: "Roadmap", content: html, version: 1 });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.version, 2);

      const reopened = await alice.get(`/api/documents/${id}`);
      assert.equal(reopened.body.title, "Roadmap");
      assert.equal(reopened.body.content, html);
    });

    it("validates input", async () => {
      const { body } = await alice.post("/api/documents").send({});
      assert.equal(body.title, "Untitled document");
      const empty = await alice.put(`/api/documents/${body.id}`).send({});
      assert.equal(empty.status, 400);
      const blankTitle = await alice.put(`/api/documents/${body.id}`).send({ title: "   " });
      assert.equal(blankTitle.status, 400);
      const missing = await alice.get("/api/documents/99999");
      assert.equal(missing.status, 404);
      const junk = await alice.get("/api/documents/abc");
      assert.equal(junk.status, 404);
    });

    it("strips scripts and event handlers from saved content", async () => {
      const { body } = await alice.post("/api/documents").send({
        title: "XSS",
        content: '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      });
      assert.equal(body.content, "<p>hi</p>");
    });

    it("builds list snippets with spaces between blocks", async () => {
      await alice.post("/api/documents").send({ title: "Snip", content: "<h2>Roadmap</h2><p>Notes</p><ul><li>one</li></ul>" });
      const list = await alice.get("/api/documents");
      assert.equal(list.body.owned.find((d) => d.title === "Snip").snippet, "Roadmap Notes one");
    });

    it("rejects a stale save with 409 and returns the current version", async () => {
      const { body: doc } = await alice.post("/api/documents").send({ title: "Race", content: "<p>v1</p>" });
      const first = await alice.put(`/api/documents/${doc.id}`).send({ content: "<p>a</p>", version: doc.version });
      assert.equal(first.status, 200);
      const stale = await alice.put(`/api/documents/${doc.id}`).send({ content: "<p>b</p>", version: doc.version });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.current.content, "<p>a</p>");
    });
  });

  describe("sharing and access control", () => {
    let docId;
    before(async () => {
      const { body } = await alice.post("/api/documents").send({ title: "Secret", content: "<p>private</p>" });
      docId = body.id;
    });

    it("hides a document from users it isn't shared with", async () => {
      const res = await carol.get(`/api/documents/${docId}`);
      assert.equal(res.status, 404);
      const list = await carol.get("/api/documents");
      assert.ok(!list.body.owned.concat(list.body.shared).some((d) => d.id === docId));
    });

    it("lets only the owner share, and validates the target", async () => {
      assert.equal((await bob.post(`/api/documents/${docId}/shares`).send({ email: "carol@example.com" })).status, 404);
      assert.equal((await alice.post(`/api/documents/${docId}/shares`).send({ email: "ghost@example.com" })).status, 404);
      assert.equal((await alice.post(`/api/documents/${docId}/shares`).send({ email: "alice@example.com" })).status, 400);
      assert.equal(
        (await alice.post(`/api/documents/${docId}/shares`).send({ email: "bob@example.com", role: "admin" })).status,
        400,
      );
    });

    it("grants viewer access: can read, cannot edit or delete, shows up as shared", async () => {
      const share = await alice.post(`/api/documents/${docId}/shares`).send({ email: "bob@example.com", role: "viewer" });
      assert.equal(share.status, 201);

      const read = await bob.get(`/api/documents/${docId}`);
      assert.equal(read.status, 200);
      assert.equal(read.body.role, "viewer");
      assert.equal(read.body.shares, undefined, "non-owners must not see the share list");

      assert.equal((await bob.put(`/api/documents/${docId}`).send({ content: "<p>hax</p>" })).status, 403);
      assert.equal((await bob.delete(`/api/documents/${docId}`)).status, 403);

      const list = await bob.get("/api/documents");
      const entry = list.body.shared.find((d) => d.id === docId);
      assert.equal(entry.role, "viewer");
      assert.equal(entry.owner.email, "alice@example.com");
    });

    it("upgrades to editor so the collaborator can edit, then revocation removes access", async () => {
      await alice.post(`/api/documents/${docId}/shares`).send({ email: "bob@example.com", role: "editor" });
      const edit = await bob.put(`/api/documents/${docId}`).send({ content: "<p>bob was here</p>" });
      assert.equal(edit.status, 200);
      assert.equal((await alice.get(`/api/documents/${docId}`)).body.content, "<p>bob was here</p>");

      const revoke = await alice.get(`/api/documents/${docId}`);
      const bobShare = revoke.body.shares.find((s) => s.email === "bob@example.com");
      assert.equal((await alice.delete(`/api/documents/${docId}/shares/${bobShare.id}`)).status, 200);
      assert.equal((await bob.get(`/api/documents/${docId}`)).status, 404);
    });
  });

  describe("file upload", () => {
    it("turns a .txt file into a new document", async () => {
      const res = await alice
        .post("/api/documents/import")
        .attach("file", Buffer.from("First para\n\nSecond <b>para</b>\nsame para"), "meeting_notes.txt");
      assert.equal(res.status, 201);
      assert.equal(res.body.title, "meeting notes");
      assert.equal(res.body.content, "<p>First para</p><p>Second &lt;b&gt;para&lt;/b&gt;<br />same para</p>");
    });

    it("converts markdown formatting into rich text", async () => {
      const res = await alice
        .post("/api/documents/import")
        .attach("file", Buffer.from("# Title\n\nSome **bold** and *italic*\n\n- a\n- b\n"), "readme.md");
      assert.equal(res.status, 201);
      assert.match(res.body.content, /<h1>Title<\/h1>/);
      assert.match(res.body.content, /<strong>bold<\/strong>/);
      assert.match(res.body.content, /<li>a<\/li>/);
    });

    it("converts a .docx file", async () => {
      const buf = await makeDocx(["Hello from Word", "Second paragraph"]);
      const res = await alice.post("/api/documents/import").attach("file", buf, "report.docx");
      assert.equal(res.status, 201);
      assert.equal(res.body.content, "<p>Hello from Word</p><p>Second paragraph</p>");
    });

    it("parses without saving for insert-into-draft", async () => {
      const res = await alice.post("/api/import/parse").attach("file", Buffer.from("just text"), "a.txt");
      assert.equal(res.status, 200);
      assert.equal(res.body.html, "<p>just text</p>");
    });

    it("rejects unsupported, empty, corrupt and oversized files with clear errors", async () => {
      const pdf = await alice.post("/api/documents/import").attach("file", Buffer.from("%PDF"), "x.pdf");
      assert.equal(pdf.status, 400);
      assert.match(pdf.body.error, /Unsupported file type/);

      const empty = await alice.post("/api/documents/import").attach("file", Buffer.from("  \n "), "e.txt");
      assert.equal(empty.status, 400);

      const corrupt = await alice.post("/api/documents/import").attach("file", Buffer.from("not a zip"), "bad.docx");
      assert.equal(corrupt.status, 400);

      const none = await alice.post("/api/documents/import");
      assert.equal(none.status, 400);

      const big = await alice.post("/api/documents/import").attach("file", Buffer.alloc(5 * 1024 * 1024 + 1, "a"), "big.txt");
      assert.equal(big.status, 413);
    });
  });
});
