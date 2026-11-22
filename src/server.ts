import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { withNotePage, loginStart, loginFinish, withHeldNotePage, inHeldSession, reviewFinish } from './browser.js';
import { saveDraft, setCover, addBodyImage, preparePaid, publish, addTags } from './note.js';
import { noteUrl, safeError } from './security.js';
import { splitPaidPreview } from './blocks.js';

const image = z.object({
  url: z.string().url().optional().describe('HTTPS public image URL. Host must be in IMAGE_ALLOWED_HOSTS'),
  base64: z.string().optional().describe('Base64 image bytes; no local file needed'),
  filename: z.string().max(100).optional()
});
const blocks = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: z.string().min(1).max(10000) }),
  z.object({ type: z.literal('heading'), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal('image'), image, alt: z.string().max(250).optional() })
])).min(1).max(100);

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
async function tool<T>(fn: () => Promise<T>): Promise<Result> {
  try { return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: safeError(error) }] }; }
}
export function buildMcpServer(): McpServer {
  const s = new McpServer({ name: 'note-remote-mcp', version: '0.1.0' });

  s.registerTool('note_login_start', {
    description: 'Start a manual login in a remotely hosted Browserbase browser. The returned Live View URL is sensitive.',
    inputSchema: z.object({})
  }, async () => tool(loginStart));

  s.registerTool('note_login_finish', {
    description: 'After logging in to note.com in the Live View, verify authentication and persist cloud-browser context.',
    inputSchema: z.object({ sessionId: z.string().min(5) })
  }, async ({ sessionId }) => tool(() => loginFinish(sessionId)));

  s.registerTool('note_session_check', {
    description: 'Check if the Browserbase context is authenticated with note.com; does not post.',
    inputSchema: z.object({})
  }, async () => tool(() => withNotePage(async page => ({ loggedIn: !/\/login/.test(page.url()), url: page.url() }))));

  s.registerTool('note_create_draft', {
    description: 'Create a draft note.com article with title, ordered text/heading/image blocks and optional cover image. Does NOT publish.',
    inputSchema: z.object({ title: z.string().min(1).max(140), blocks, coverImage: image.optional() })
  }, async ({ title, blocks, coverImage }) => tool(() => withNotePage(page => saveDraft(page, title, blocks, coverImage))));

  s.registerTool('note_set_cover_image', {
    description: 'Change an existing draft article cover/header image (見出し画像). Verify rendering before publishing.',
    inputSchema: z.object({ editorUrl: z.string().url(), image })
  }, async ({ editorUrl, image: file }) => tool(() => withNotePage(page => setCover(page, file), noteUrl(editorUrl))));

  s.registerTool('note_insert_body_image', {
    description: 'Insert image inside the article body at an optional paragraph anchor. Upload remotely.',
    inputSchema: z.object({ editorUrl: z.string().url(), image, afterText: z.string().optional() })
  }, async ({ editorUrl, image: file, afterText }) => tool(() => withNotePage(page => addBodyImage(page, file, afterText), noteUrl(editorUrl))));

  s.registerTool('note_set_hashtags', {
    description: 'Set up to 10 article hashtags using the note editor interface. Verify in Live View.',
    inputSchema: z.object({ editorUrl: z.string().url(), tags: z.array(z.string().min(1).max(80)).min(1).max(10) })
  }, async ({ editorUrl, tags }) => tool(() => withHeldNotePage(noteUrl(editorUrl), page => addTags(page, tags))));

  s.registerTool('note_paid_preview', {
    description: 'Preview the free/paid block split offline, without modifying note.com.',
    inputSchema: z.object({ blocks, paidAfterBlock: z.number().int().positive() })
  }, async ({ blocks: b, paidAfterBlock }) => tool(async () => splitPaidPreview(b, paidAfterBlock)));

  s.registerTool('note_prepare_paid_article', {
    description: 'Set note paid price (JPY) and paid boundary in a held cloud browser; requires manual verification. Does NOT publish.',
    inputSchema: z.object({ editorUrl: z.string().url(), priceYen: z.number().int().min(100).max(100000), lineAfterParagraph: z.number().int().positive() })
  }, async ({ editorUrl, priceYen, lineAfterParagraph }) => tool(() =>
    withHeldNotePage(noteUrl(editorUrl), async page => preparePaid(page, priceYen, lineAfterParagraph))));

  s.registerTool('note_review_article', {
    description: 'Open article in Live View to inspect title, cover, body images, free/paid boundary and tags. Does NOT publish.',
    inputSchema: z.object({ editorUrl: z.string().url() })
  }, async ({ editorUrl }) => tool(() => withHeldNotePage(noteUrl(editorUrl), async () => ({ needsManualVerification: true }))));

  s.registerTool('note_publish_review_session', {
    description: 'Publish after explicit manual review of a Live View. Disabled unless ENABLE_PUBLISH=true.',
    inputSchema: z.object({ sessionId: z.string().min(5), expectedTitle: z.string().min(1), paid: z.boolean(), acknowledgedPaidBoundary: z.boolean().default(false), confirmation: z.string() })
  }, async ({ sessionId, expectedTitle, paid, acknowledgedPaidBoundary, confirmation }) => tool(async () => {
    if (confirmation !== `PUBLISH ${expectedTitle}`) throw new Error('Exact confirmation phrase required');
    if (paid && !acknowledgedPaidBoundary) throw new Error('Paid preview must be manually verified');
    return inHeldSession(sessionId, page => publish(page, expectedTitle, paid), true);
  }));

  s.registerTool('note_close_review_session', {
    description: 'Close a review session without publishing.',
    inputSchema: z.object({ sessionId: z.string().min(5) })
  }, async ({ sessionId }) => tool(async () => { await reviewFinish(sessionId); return { closed: true }; }));

  return s;
}
