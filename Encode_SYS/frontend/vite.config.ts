import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { componentTagger } from "lovable-tagger";

const backend = "http://127.0.0.1:8000";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/auth": { target: backend, changeOrigin: true },
      "/civic-oauth-config": { target: backend, changeOrigin: true },
      "/status": { target: backend, changeOrigin: true },
      "/start": { target: backend, changeOrigin: true },
      "/stop": { target: backend, changeOrigin: true },
      "/unlock": { target: backend, changeOrigin: true },
      "/trades": { target: backend, changeOrigin: true },
      "/report": { target: backend, changeOrigin: true },
      "/news": { target: backend, changeOrigin: true },
      "/strategy": { target: backend, changeOrigin: true },
      "/strategy/export": { target: backend, changeOrigin: true },
      "/profile": { target: backend, changeOrigin: true },
      "/ws": { target: backend, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../backend/app/static"),
    emptyOutDir: true,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
