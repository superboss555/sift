import { defineConfig, type Plugin } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

function siftDevExtras(): Plugin {
  return {
    name: "sift-dev-extras",
    apply: "serve",
    configureServer(server) {
      // ---- 1. Ссылка на генератор в консоль ----
      server.httpServer?.once("listening", () => {
        setImmediate(() => {
          const url = server.resolvedUrls?.local?.[0];
          if (url) {
            console.log(
              `  \x1b[32m➜\x1b[0m  \x1b[1mGenerator:\x1b[0m \x1b[36m${url}generator.html\x1b[0m`,
            );
          }
        });
      });

      // ---- 2. POST /api/save-dataset ----
      server.middlewares.use("/api/save-dataset", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }

        const rawName = req.headers["x-filename"];
        const filename = typeof rawName === "string" ? rawName : "";

        if (!/^[a-z0-9._-]+$/i.test(filename)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid filename");
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks);

          const dir = path.resolve(server.config.root, "public", "datasets");
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, filename), body);

          const sizeKb = (body.length / 1024).toFixed(1);
          console.log(
            `  \x1b[32m✓\x1b[0m  Датасет сохранён: \x1b[36mpublic/datasets/${filename}\x1b[0m (${sizeKb} КБ)`,
          );

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              path: `public/datasets/${filename}`,
              size: body.length,
            }),
          );
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });

      // ---- 3. GET /api/list-files — файловый браузер проекта ----
      server.middlewares.use("/api/list-files", async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const subPath = (url.searchParams.get("dir") ?? "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");

        if (subPath.includes("..")) {
          res.statusCode = 400;
          res.end("Invalid path");
          return;
        }

        const root = server.config.root.replace(/\\/g, "/");
        const absolute = path.resolve(root, subPath);
        const rootLower = root.toLowerCase();
        const absLower = absolute.replace(/\\/g, "/").toLowerCase();

        if (absLower !== rootLower && !absLower.startsWith(rootLower + "/")) {
          res.statusCode = 403;
          res.end("Path outside project");
          return;
        }

        try {
          const entries = await fs.readdir(absolute, { withFileTypes: true });

          const IGNORED_DIRS = new Set([
            "node_modules",
            ".git",
            ".vscode",
            ".idea",
            "dist",
            ".vite",
          ]);

          const items = entries
            .filter((e) => {
              if (e.name.startsWith(".")) return false;
              if (e.isDirectory() && IGNORED_DIRS.has(e.name)) return false;
              return e.isFile() || e.isDirectory();
            })
            .map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "dir" : "file",
              path: subPath ? `${subPath}/${e.name}` : e.name,
            }));

          items.sort((a, b) => {
            if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ path: subPath, items }));
        } catch (err) {
          res.statusCode = 404;
          res.end("Cannot read directory: " + String(err));
        }
      });

      // ---- 4. GET /api/read-file — читает файл внутри проекта ----
      //      Принимает либо относительный путь от корня (public/datasets/foo.xlsx),
      //      либо абсолютный (D:/sift/...).
      server.middlewares.use("/api/read-file", async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost");
        const rawPath = url.searchParams.get("path") ?? "";
        if (!rawPath) {
          res.statusCode = 400;
          res.end("No path");
          return;
        }

        const root = server.config.root.replace(/\\/g, "/");
        const rootLower = root.toLowerCase();

        const isAbs = /^[a-zA-Z]:[\\/]/.test(rawPath) || /^\//.test(rawPath);
        let absolute: string;

        if (isAbs) {
          let p = rawPath.replace(/\\/g, "/");
          p = p.replace(/^vscode-file:\/\/vscode-app\//, "");
          p = p.replace(/^file:\/\/\//, "/");
          p = p.replace(/^\/([a-zA-Z]:)/, "$1");

          const pLower = p.toLowerCase();
          const idx = pLower.indexOf(rootLower);
          if (idx === -1) {
            res.statusCode = 403;
            res.end("Path is outside project root");
            return;
          }
          const rel = p.slice(idx + root.length).replace(/^\/+/, "");
          absolute = path.resolve(root, rel);
        } else {
          if (rawPath.includes("..")) {
            res.statusCode = 400;
            res.end("Invalid path");
            return;
          }
          absolute = path.resolve(root, rawPath.replace(/^\/+/, ""));
        }

        const absLower = absolute.replace(/\\/g, "/").toLowerCase();
        if (absLower !== rootLower && !absLower.startsWith(rootLower + "/")) {
          res.statusCode = 403;
          res.end("Path escapes project root");
          return;
        }

        try {
          const data = await fs.readFile(absolute);
          const name = path.basename(absolute);
          const ext = name.split(".").pop()?.toLowerCase() ?? "";

          const mime =
            ext === "csv"
              ? "text/csv; charset=utf-8"
              : ext === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : ext === "xls"
                  ? "application/vnd.ms-excel"
                  : "application/octet-stream";

          res.statusCode = 200;
          res.setHeader("Content-Type", mime);
          res.setHeader("X-Filename", name);
          res.end(data);
        } catch (err) {
          res.statusCode = 404;
          res.end("File not found: " + String(err));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [siftDevExtras()],
  server: {
    watch: {
      ignored: ["**/public/datasets/**"],
    },
  },
});