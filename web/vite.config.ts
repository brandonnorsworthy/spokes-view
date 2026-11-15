import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm run dev` proxies the API to a locally running spokes-view backend.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    proxy: { "/api": "http://127.0.0.1:8788" },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
