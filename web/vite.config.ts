import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/session": { target: process.env.PLANNER_PROXY_TARGET ?? "http://127.0.0.1:3002", changeOrigin: false },
      "/api/chat": { target: process.env.PLANNER_PROXY_TARGET ?? "http://127.0.0.1:3002", changeOrigin: false },
      "/api/recommendations": { target: process.env.PLANNER_PROXY_TARGET ?? "http://127.0.0.1:3002", changeOrigin: false },
      "/api/planner": { target: process.env.PLANNER_PROXY_TARGET ?? "http://127.0.0.1:3002", changeOrigin: false },
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
