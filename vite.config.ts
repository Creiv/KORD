import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

function configFilePath() {
  const userDir = process.env.KORD_USER_CONFIG_DIR || process.env.WPP_USER_CONFIG_DIR;
  if (userDir && String(userDir).trim()) {
    return join(resolve(String(userDir).trim()), "music-root.config.json");
  }
  return join(__dirname, "server", "music-root.config.json");
}

function readListenOnLanFromDisk() {
  try {
    const p = configFilePath();
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8"));
      return Boolean(j?.listenOnLan);
    }
  } catch {
    /* ignore */
  }
  return false;
}

const exposeLan =
  readListenOnLanFromDisk() || process.env.KORD_LISTEN_ON_LAN === "1";

// https://vite.dev/config/
export default defineConfig({
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
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    host: exposeLan ? true : undefined,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
