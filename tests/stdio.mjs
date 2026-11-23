import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('discovers note tools and previews the paid boundary over stdio', { timeout: 10_000 }, async (t) => {
  const client = new Client({ name: 'note-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../dist/src/stdio.js', import.meta.url))],
    env: { NOTE_BROWSER_BACKEND: 'local' },
  });
  t.after(() => client.close());
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.match(tools.find(({ name }) => name === 'note_login_start').description, /local Chrome/);
  assert.ok(tools.some(({ name }) => name === 'note_create_draft'));
  assert.ok(tools.some(({ name }) => name === 'note_publish_review_session'));

  const free = { type: 'paragraph', text: 'Free preview' };
  const paid = { type: 'paragraph', text: 'Paid content' };
  const result = await client.callTool({
    name: 'note_paid_preview',
    arguments: { blocks: [free, paid], paidAfterBlock: 1 },
  });
  assert.equal(result.isError ?? false, false);
  assert.deepEqual(JSON.parse(result.content[0].text), { free: [free], paid: [paid] });

  const stale = await client.callTool({
    name: 'note_login_finish',
    arguments: { sessionId: 'missing-session' },
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /Local browser session has ended/);
});
