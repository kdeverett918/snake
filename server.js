const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const MIME_BY_EXT = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
]);

function normalizePathname(pathname) {
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith("/")) return null;
  return pathname;
}

function resolveStaticPath(rootDir, pathname) {
  const rel = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(rootDir, rel);
  const rootResolved = path.resolve(rootDir);

  if (resolved === rootResolved) return resolved;
  if (!resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT.get(ext) ?? "application/octet-stream";
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

function createAppServer({ rootDir }) {
  const rootResolved = path.resolve(rootDir);

  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = normalizePathname(url.pathname);
    if (!pathname) {
      sendText(res, 400, "Bad Request");
      return;
    }

    if (pathname === "/healthz") {
      sendText(res, 200, "ok");
      return;
    }

    const targetPath = pathname === "/" ? "/index.html" : pathname;
    const fsPath = resolveStaticPath(rootResolved, targetPath);
    if (!fsPath) {
      sendText(res, 404, "Not Found");
      return;
    }

    let stat;
    try {
      stat = await fs.stat(fsPath);
    } catch {
      sendText(res, 404, "Not Found");
      return;
    }

    if (stat.isDirectory()) {
      sendText(res, 404, "Not Found");
      return;
    }

    let data;
    try {
      data = await fs.readFile(fsPath);
    } catch {
      sendText(res, 500, "Internal Server Error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypeFor(fsPath),
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  const host = "0.0.0.0";
  const server = createAppServer({ rootDir: __dirname });
  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`Gravity Snake running on http://${host}:${port}`);
  });
}

module.exports = { createAppServer };

