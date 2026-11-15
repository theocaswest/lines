// Zero-dependency static server, so you can rehearse from your phone.
// Usage: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = resolve(import.meta.dirname);
const port = Number(process.argv[2]) || 4173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

let activePort = port;
let tries = 0;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && tries < 10) {
    tries++;
    activePort = port + tries;
    server.listen(activePort, '0.0.0.0');
    return;
  }
  console.error('\n  Could not start:', err.message, '\n');
  process.exit(1);
});

server.on('listening', () => {
  console.log(`\n  Lines is running:\n    http://localhost:${activePort}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`    http://${net.address}:${activePort}   (same Wi-Fi, e.g. your phone)`);
      }
    }
  }
  console.log('\n  Ctrl+C to stop.\n');
});

server.listen(activePort, '0.0.0.0');
