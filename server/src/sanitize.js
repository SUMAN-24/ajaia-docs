import sanitizeHtml from "sanitize-html";

/**
 * Documents are stored as HTML (TipTap's native serialization). Anything that
 * reaches the database — editor saves, imported files — passes through this
 * allow-list so stored content can never carry scripts or event handlers.
 */
const OPTIONS = {
  allowedTags: [
    "h1", "h2", "h3", "p", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "a",
  ],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow", target: "_blank" }, true),
    // Word often maps "Title" / h4-h6 oddly; collapse deeper headings to h3.
    h4: "h3", h5: "h3", h6: "h3",
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ""), OPTIONS);
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
