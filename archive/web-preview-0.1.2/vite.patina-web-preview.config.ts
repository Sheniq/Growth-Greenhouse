import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

function patinaDatabasePath(value: string | null) {
  if (value?.trim()) return value.trim();
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appData, "Patina", "patina.db");
}

function json(response: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body: string) => void }, statusCode: number, value: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  response.end(JSON.stringify(value));
}

function patinaWebApi() {
  return {
    name: "growth-greenhouse-patina-web-api",
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string; method?: string; on: (event: string, listener: (...args: unknown[]) => void) => void }, response: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/patina/")) {
          next();
          return;
        }

        const databasePath = patinaDatabasePath(url.searchParams.get("path"));
        const installed = existsSync(join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Patina", "Patina.exe"));
        if (url.pathname === "/api/patina/source") {
          json(response, 200, { available: existsSync(databasePath), installed, databasePath, lastModifiedMs: existsSync(databasePath) ? statSync(databasePath).mtimeMs : null });
          return;
        }
        if (url.pathname === "/api/patina/upload") {
          if (request.method !== "POST") {
            json(response, 405, { error: "Method not allowed" });
            return;
          }
          const chunks: Buffer[] = [];
          request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
          request.on("end", () => {
            const selectedPath = join(tmpdir(), "growth-greenhouse-selected-patina.db");
            try {
              writeFileSync(selectedPath, Buffer.concat(chunks));
              const database = new DatabaseSync(selectedPath, { readOnly: true });
              database.prepare("SELECT COUNT(*) AS count FROM sessions").get();
              database.close();
              json(response, 200, { available: true, installed, databasePath: selectedPath, lastModifiedMs: statSync(selectedPath).mtimeMs });
            } catch (error) {
              json(response, 400, { error: `选中的文件不是可读取的 Patina 数据库：${error instanceof Error ? error.message : String(error)}` });
            }
          });
          return;
        }
        if (url.pathname !== "/api/patina/sessions") {
          json(response, 404, { error: "Not found" });
          return;
        }

        const sinceMs = Number(url.searchParams.get("sinceMs"));
        const untilMs = Number(url.searchParams.get("untilMs"));
        if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
          json(response, 400, { error: "Invalid time range" });
          return;
        }
        if (!existsSync(databasePath)) {
          json(response, 404, { error: `没有找到 Patina 数据库：${databasePath}` });
          return;
        }
        try {
          const database = new DatabaseSync(databasePath, { readOnly: true });
          const rows = database.prepare(`SELECT id, app_name AS appName, exe_name AS exeName, start_time AS startTime, end_time AS endTime, duration AS durationMs
            FROM sessions WHERE start_time < ? AND COALESCE(end_time, ?) > ? ORDER BY start_time ASC, id ASC`).all(untilMs, untilMs, sinceMs);
          database.close();
          json(response, 200, rows);
        } catch (error) {
          json(response, 500, { error: `读取 Patina 会话失败：${error instanceof Error ? error.message : String(error)}` });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), patinaWebApi()],
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: { target: "es2021" },
});
