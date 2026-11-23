#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLocalBrowser } from './local-browser.js';
import { buildMcpServer } from './server.js';

const backend = process.env.NOTE_BROWSER_BACKEND ?? 'local';
if (backend !== 'local' && backend !== 'browserbase')
  throw new Error('NOTE_BROWSER_BACKEND must be local or browserbase');

const browser = backend === 'local' ? createLocalBrowser() : undefined;
const server = serveStdio(() => buildMcpServer(browser));

if (browser) {
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await Promise.allSettled([server.close(), browser?.shutdown()]);
    process.exit(0);
  }
  process.stdin.once('end', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
