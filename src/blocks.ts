export type ArticleBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'image'; image: { base64?: string; url?: string; filename?: string }; alt?: string };

export function validateBlocks(blocks: ArticleBlock[], paidAfter?: number): void {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 100) throw new Error('1–100 blocks required');
  for (const block of blocks) {
    if (!['paragraph', 'heading', 'image'].includes(block.type)) throw new Error('Unsupported block type');
    if (block.type !== 'image' && (!block.text.trim() || block.text.length > 10000))
      throw new Error('Text block is empty or too long');
  }
  if (blocks.filter(block => block.type === 'image').length > 10) throw new Error('Maximum 10 body images');
  if (paidAfter !== undefined && (!Number.isInteger(paidAfter) || paidAfter < 1 || paidAfter >= blocks.length))
    throw new Error('paidAfter must be a block boundary (1 .. blocks.length-1)');
}

export function splitPaidPreview(blocks: ArticleBlock[], paidAfter: number) {
  validateBlocks(blocks, paidAfter);
  return { free: blocks.slice(0, paidAfter), paid: blocks.slice(paidAfter) };
}
