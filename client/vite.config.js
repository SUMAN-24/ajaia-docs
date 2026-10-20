import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev the API runs separately on :3001; in production Express serves the built client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  test: { environment: "node" },
});
