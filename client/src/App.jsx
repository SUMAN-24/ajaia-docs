import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, setUnauthorizedHandler } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import EditorPage from "./pages/EditorPage.jsx";
import Login from "./pages/Login.jsx";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

function ToastHost({ toasts }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking session
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();

  const toast = useCallback((message, kind = "info") => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const auth = useMemo(
    () => ({
      user,
      login: async (email, password) => {
        const { user: u } = await api.login(email, password);
        setUser(u);
      },
      logout: async () => {
        await api.logout().catch(() => {});
        setUser(null);
        navigate("/login");
      },
    }),
    [user, navigate],
  );

  if (user === undefined) return <div className="splash">Loading…</div>;

  return (
    <AuthContext.Provider value={auth}>
      <ToastContext.Provider value={toast}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
          <Route path="/docs/:id" element={user ? <EditorPage /> : <Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastHost toasts={toasts} />
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}
