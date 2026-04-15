const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8099;
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

http.createServer((req, res) => {
  const filePath = path.join(__dirname, req.url === '/' ? '/test.html' : req.url);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving at http://localhost:${PORT}`));
