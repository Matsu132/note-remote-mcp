import { validateExternalImageUrl } from './security.js';
import { detectImage } from './image-format.js';

export interface ImageInput { base64?: string; url?: string; filename?: string }
export interface ImageFile { buffer: Buffer; mimeType: string; name: string }
const MAX_BYTES = 6 * 1024 * 1024;

export async function loadImage(input: ImageInput): Promise<ImageFile> {
  if (!!input.base64 === !!input.url) throw new Error('Supply exactly one of base64 or url');
  let buffer: Buffer;
  if (input.base64) {
    if (input.base64.length > MAX_BYTES * 1.4) throw new Error('Image is too large');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0)
      throw new Error('Invalid base64 image');
    buffer = Buffer.from(input.base64, 'base64');
  } else {
    const hosts = (process.env.IMAGE_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const url = await validateExternalImageUrl(input.url!, hosts);
    const abort = AbortSignal.timeout(10000);
    const response = await fetch(url, { redirect: 'error', signal: abort, headers: { Accept: 'image/*' } });
    if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('Image is too large');
    // Stream in bounded chunks, even if Content-Length is missing.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty image response');
    const chunks: Buffer[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) throw new Error('Image is too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    buffer = Buffer.concat(chunks);
  }
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large');
  const { mime, ext } = detectImage(buffer);
  const name = (input.filename ?? `note-image.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return { buffer, mimeType: mime, name };
}
