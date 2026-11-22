import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildMcpServer } from './server.js';
import { tokenMatches } from './security.js';

// The SDK defaults to a 4 MiB request body, which is smaller than one 6 MiB Base64 image.
// Allow up to 16 MiB per MCP request; larger batches should use allowlisted HTTPS image URLs.
const handler = createMcpHandler(buildMcpServer, { maxRequestBodySize: 16 * 1024 * 1024 });
const mcp = toNodeHandler(handler);
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
if (!process.env.MCP_ACCESS_TOKEN || process.env.MCP_ACCESS_TOKEN.length < 24)
  throw new Error('Configure a long MCP_ACCESS_TOKEN before starting the public endpoint');

createServer((req, res) => {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, name: 'note-remote-mcp' })); return;
  }
  if (pathname !== '/mcp' || !['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return;
  }
  const authHeader = req.headers.authorization ?? '';
  const bearer = /^Bearer (\S+)$/.exec(authHeader)?.[1];
  if (!tokenMatches(bearer, process.env.MCP_ACCESS_TOKEN)) {
    res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store', 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'Unauthorized' })); return;
  }
  const origin = req.headers.origin;
  // Intended for non-browser clients. Reject arbitrary browser origins.
  if (origin) { res.writeHead(403).end('Browser origin not permitted'); return; }
  void Promise.resolve(mcp(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'MCP request failed' }));
  });
}).listen(port, '0.0.0.0', () => {
  console.info(`note-remote-mcp listening on :${port}`);
});
