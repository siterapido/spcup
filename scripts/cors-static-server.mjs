import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2] ?? process.cwd();
const port = Number(process.argv[3] ?? 8765);

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const rel = decodeURIComponent((req.url ?? "/").split("?")[0] || "/");
  const filePath = path.join(root, rel);
  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`CORS static ${root} → http://localhost:${port}`);
});
