import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlocks, splitPaidPreview } from '../src/blocks.ts';
import { noteUrl, tokenMatches, safeError } from '../src/security.ts';
import { detectImage } from '../src/image-format.ts';

test('paid boundary splits at the expected block', () => {
  const blocks = [{type:'paragraph',text:'Free'}, {type:'paragraph',text:'Paid'}];
  assert.deepEqual(splitPaidPreview(blocks, 1), {free:[blocks[0]],paid:[blocks[1]]});
});
test('paid boundary rejects outside range', () => {
  assert.throws(() => validateBlocks([{type:'paragraph',text:'Only one'}],1), /paidAfter/);
});
test('tool input does not accept arbitrary hosts', () => {
  assert.equal(noteUrl('https://note.com/example/n/abcdef'), 'https://note.com/example/n/abcdef');
  assert.equal(noteUrl('https://note.com/notes/new'), 'https://note.com/notes/new');
  assert.throws(() => noteUrl('https://evil.com/notes/new'));
  assert.throws(() => noteUrl('https://note.com.evil.com/notes/new'));
  assert.throws(() => noteUrl('http://note.com/notes/new'));
});
test('secrets compared and errors sanitized', () => {
  assert.equal(tokenMatches('long-secure-token-long-secure-token', 'long-secure-token-long-secure-token'), true);
  assert.equal(tokenMatches('x', 'long-secure-token-long-secure-token'), false);
  assert.doesNotMatch(safeError(new Error('token=abc http://secret.example/path')), /abc|secret\.example/);
});
test('image signature detection rejects spoofed file types', () => {
  assert.equal(detectImage(Buffer.from('89504e470d0a1a0a01020304', 'hex')).mime, 'image/png');
  assert.equal(detectImage(Buffer.from('ffd8ffe00001020304050607', 'hex')).mime, 'image/jpeg');
  assert.equal(detectImage(Buffer.from('474946383961000000000000', 'hex')).mime, 'image/gif');
  assert.throws(() => detectImage(Buffer.alloc(20)), /Unsupported image/);
});
