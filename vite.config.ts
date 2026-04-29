import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Impostare `KORD_LISTEN_ON_LAN=1` per esporre il dev server sulla LAN (proxy /api verso localhost). */
const exposeLan = process.env.KORD_LISTEN_ON_LAN === "1";

const packageVersion = (() => {
  try {
    const raw = readFileSync(join(__dirname, "package.json"), "utf8");
    return String(JSON.parse(raw)?.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

// https://vite.dev/config/
export default defineConfig({
  define: {
    "import.meta.env.VITE_KORD_VERSION": JSON.stringify(packageVersion),
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts"],
  },
  server: {
    port: 5173,
    host: exposeLan ? true : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    host: exposeLan ? true : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
