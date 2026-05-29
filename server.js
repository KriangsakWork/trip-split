const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 4173;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const requestedPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.resolve(root, requestedPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Trip Split is running at http://localhost:${port}`);
});
