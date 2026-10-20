export class ApiError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

async function request(path, { method = "GET", json, formData } = {}) {
  const init = { method, credentials: "same-origin", headers: {} };
  if (json !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  } else if (formData) {
    init.body = formData;
  }

  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body);
  }
  return body;
}

export const api = {
  me: () => request("/auth/me"),
  login: (email, password) => request("/auth/login", { method: "POST", json: { email, password } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  users: () => request("/users"),

  listDocs: () => request("/documents"),
  createDoc: (title) => request("/documents", { method: "POST", json: { title } }),
  getDoc: (id) => request(`/documents/${id}`),
  updateDoc: (id, patch) => request(`/documents/${id}`, { method: "PUT", json: patch }),
  deleteDoc: (id) => request(`/documents/${id}`, { method: "DELETE" }),

  importDoc: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/documents/import", { method: "POST", formData });
  },
  parseFile: (file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("/import/parse", { method: "POST", formData });
  },

  share: (id, email, role) => request(`/documents/${id}/shares`, { method: "POST", json: { email, role } }),
  unshare: (id, userId) => request(`/documents/${id}/shares/${userId}`, { method: "DELETE" }),
};
