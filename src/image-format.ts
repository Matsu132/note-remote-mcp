export function detectImage(buffer: Buffer): { mime: string; ext: string } {
  if (buffer.length < 12) throw new Error('Image payload is too short');
  if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { mime: 'image/png', ext: 'png' };
  const sig = buffer.subarray(0, 6).toString('ascii');
  if (sig === 'GIF87a' || sig === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  const brand = buffer.subarray(8, 12).toString('ascii');
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
      ['heic', 'heix', 'hevc', 'mif1'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
  throw new Error('Unsupported image bytes. Use JPEG, PNG, GIF or HEIC');
}
