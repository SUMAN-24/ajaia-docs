import path from "node:path";
import mammoth from "mammoth";
import { marked } from "marked";
import { escapeHtml, sanitizeContent } from "./sanitize.js";

export const SUPPORTED_EXTENSIONS = [".txt", ".md", ".docx"];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function textToHtml(text) {
  // Blank lines separate paragraphs; single newlines become <br>.
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function titleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ").trim();
  return (base || "Imported document").slice(0, 200);
}

/**
 * Converts an uploaded file into { title, html } (html already sanitized).
 * Throws ImportError for unsupported or unreadable files.
 */
export async function parseUpload(file) {
  if (!file) throw new ImportError("No file uploaded. Attach a .txt, .md or .docx file.");
  const ext = path.extname(file.originalname).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ImportError(`Unsupported file type "${ext || "unknown"}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
  }

  let html;
  try {
    if (ext === ".docx") {
      const result = await mammoth.convertToHtml({ buffer: file.buffer });
      html = result.value;
    } else {
      const text = file.buffer.toString("utf8");
      html = ext === ".md" ? await marked.parse(text, { gfm: true }) : textToHtml(text);
    }
  } catch {
    throw new ImportError("Could not read that file. Is it a valid " + ext + " file?");
  }

  const clean = sanitizeContent(html);
  if (!clean.trim()) throw new ImportError("The file appears to be empty.");
  return { title: titleFromFilename(file.originalname), html: clean };
}
