export const SUPPORTED_UPLOADS = [".txt", ".md", ".docx"];
export const MAX_UPLOAD_MB = 5;

/** "just now", "5 min ago", "3 h ago", "Oct 4" — compact timestamps for lists. */
export function timeAgo(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function roleLabel(role) {
  return { owner: "Owner", editor: "Can edit", viewer: "Can view" }[role] ?? role;
}

/** Client-side pre-check so users get instant feedback; the server re-validates. */
export function validateUpload(file) {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  if (!SUPPORTED_UPLOADS.includes(ext)) {
    return `Unsupported file type "${ext || "unknown"}". Supported: ${SUPPORTED_UPLOADS.join(", ")}`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is too large (max ${MAX_UPLOAD_MB} MB)`;
  if (file.size === 0) return "That file is empty";
  return null;
}

export function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
