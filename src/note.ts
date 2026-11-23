import type { Page, Locator } from 'playwright-core';
import { loadImage, type ImageInput } from './media.js';
import { validateBlocks, type ArticleBlock } from './blocks.js';
import { noteUrl } from './security.js';

async function clickOne(page: Page, names: RegExp[], optional = false): Promise<boolean> {
  for (const name of names) {
    const candidates = [page.getByRole('button', { name }), page.getByText(name, { exact: true })];
    for (const locator of candidates) {
      if (await locator.count() && await locator.first().isVisible()) {
        await locator.first().click({ timeout: 6000 });
        return true;
      }
    }
  }
  if (optional) return false;
  throw new Error('note UI changed: expected button missing');
}

async function editor(page: Page): Promise<Locator> {
  const contentEditables = page.locator('[contenteditable="true"]');
  if (!await contentEditables.count()) throw new Error('note editor not found; re-login or inspect page');
  return contentEditables.last();
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const locators = [
    page.getByRole('textbox', { name: /タイトル/ }),
    page.getByPlaceholder(/タイトル/),
    page.locator('textarea[placeholder*="タイトル"],input[placeholder*="タイトル"]')
  ];
  for (const locator of locators) {
    if (await locator.count() && await locator.first().isVisible()) {
      await locator.first().fill(title);
      return;
    }
  }
  throw new Error('Title editor not found; note UI may have changed');
}

async function uploadUsingChooser(page: Page, triggers: RegExp[], image: ImageInput): Promise<void> {
  const file = await loadImage(image);
  let succeeded = false;
  for (const trigger of triggers) {
    const buttons = [page.getByRole('button', { name: trigger }), page.getByText(trigger, { exact: true })];
    for (const button of buttons) {
      if (!await button.count() || !await button.first().isVisible()) continue;
      try {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 4000 });
        await button.first().click();
        const chooser = await chooserPromise;
        await chooser.setFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
        succeeded = true;
        break;
      } catch {
        // Try another trigger. Never inject directly into private note.com APIs.
      }
    }
    if (succeeded) break;
  }
  if (!succeeded) throw new Error('Image file chooser not found; note UI selector needs updating');
  await page.waitForTimeout(700);
}

async function insertImage(page: Page, image: ImageInput): Promise<void> {
  await clickOne(page, [/^\+$/, /追加/, /挿入/]);
  await uploadUsingChooser(page, [/^画像$/, /画像を挿入/], image);
}

async function typeBlocks(page: Page, blocks: ArticleBlock[]): Promise<void> {
  const body = await editor(page);
  await body.click();
  for (const [index, block] of blocks.entries()) {
    if (index > 0) await page.keyboard.press('Enter');
    if (block.type === 'image') {
      await insertImage(page, block.image);
      continue;
    }
    await page.keyboard.insertText(block.text);
    if (block.type === 'heading') {
      const didClick = await clickOne(page, [/見出しにする/, /見出し/], true);
      if (!didClick) throw new Error('Heading toolbar unavailable; draft may be partially edited');
    }
  }
}

export async function saveDraft(page: Page, title: string, blocks: ArticleBlock[], cover?: ImageInput) {
  validateBlocks(blocks);
  if (!title.trim() || title.length > 140) throw new Error('Title must be 1–140 characters');
  if (!/\/notes\/new/.test(page.url())) throw new Error('Not on the new note article page');
  await fillTitle(page, title.trim());
  if (cover) await uploadUsingChooser(page, [/見出し画像/, /画像を追加/, /画像を設定/], cover);
  await typeBlocks(page, blocks);
  await clickOne(page, [/下書き保存/, /保存する/, /^保存$/]);
  await page.waitForTimeout(1000);
  const url = page.url();
  if (url.endsWith('/notes/new')) throw new Error('Draft save not verified: editor URL did not change');
  return { editorUrl: noteUrl(url), title, blockCount: blocks.length, coverProvided: !!cover };
}

export async function setCover(page: Page, image: ImageInput) {
  await uploadUsingChooser(page, [/見出し画像/, /画像を変更/, /画像を設定/], image);
  await clickOne(page, [/下書き保存/, /保存する/, /^保存$/], true);
  return { editorUrl: noteUrl(page.url()), message: 'Cover file selected; verify rendering in the note editor' };
}

export async function addBodyImage(page: Page, image: ImageInput, afterText?: string) {
  if (afterText) {
    const p = page.getByText(afterText, { exact: true });
    if (!await p.count()) throw new Error('Anchor paragraph not found');
    await p.first().click();
  } else {
    await (await editor(page)).click();
  }
  await insertImage(page, image);
  await clickOne(page, [/下書き保存/, /保存する/, /^保存$/], true);
  return { editorUrl: noteUrl(page.url()), message: 'Image selected; verify upload and position in the note editor' };
}

export async function preparePaid(page: Page, priceYen: number, lineAfterParagraph: number) {
  if (!Number.isInteger(priceYen) || priceYen < 100 || priceYen > 100000)
    throw new Error('Price out of supported range; verify note account limits');
  if (!Number.isInteger(lineAfterParagraph) || lineAfterParagraph < 1)
    throw new Error('lineAfterParagraph must be a positive integer');
  await clickOne(page, [/公開に進む/, /公開設定/]);
  await clickOne(page, [/^有料$/, /有料記事/]);
  const priceInput = page.getByRole('spinbutton', { name: /価格|金額/ });
  const fallback = page.locator('input[placeholder*="価格"],input[name*="price"]');
  const input = await priceInput.count() ? priceInput.first() : fallback.first();
  if (!await input.count()) throw new Error('Paid price input not found');
  await input.fill(String(priceYen));
  await clickOne(page, [/有料エリア設定/]);
  const lines = page.getByText(/ラインをこの場所に変更/);
  if (await lines.count() < lineAfterParagraph)
    throw new Error('Requested paid boundary not offered by the current editor');
  await lines.nth(lineAfterParagraph - 1).click();
  return {
    priceYen, lineAfterParagraph, needsManualVerification: true,
    message: 'Boundary selected in note UI. Inspect the paid preview before publishing.'
  };
}

export async function publish(page: Page, title: string, paid: boolean): Promise<{ publishedUrl: string }> {
  if (process.env.ENABLE_PUBLISH !== 'true')
    throw new Error('Publishing disabled. Set ENABLE_PUBLISH=true after manual verification');
  if (!title.trim()) throw new Error('Expected title required');
  const heading = page.getByText(title, { exact: true });
  if (!await heading.count()) throw new Error('Article title mismatch. Publish aborted');
  if (paid) {
    const paidMarker = page.getByText(/ここから先は有料|有料エリア/);
    if (!await paidMarker.count()) throw new Error('Paid boundary not detected. Publish aborted');
  }
  await clickOne(page, [/^投稿する$/, /^公開する$/, /^公開$/]);
  await page.waitForTimeout(1500);
  const current = page.url();
  if (!/^https:\/\/note\.com\/[^/]+\/n\/[^/]+/.test(current))
    throw new Error('Publication not verified; inspect before retrying. It may have succeeded.');
  return { publishedUrl: noteUrl(current) };
}

export async function addTags(page: Page, tags: string[]) {
  if (tags.length < 1 || tags.length > 10 || tags.some(t => !t.trim() || t.length > 80))
    throw new Error('Provide 1–10 hashtags, each 1–80 characters');
  await clickOne(page, [/公開に進む/, /公開設定/], true);
  for (const tag of tags) {
    await clickOne(page, [/ハッシュタグを追加/, /ハッシュタグ/], true);
    const input = page.getByRole('textbox', { name: /ハッシュタグ|タグ/ });
    const fallback = page.locator('input[placeholder*="タグ"]');
    const field = await input.count() ? input.last() : fallback.last();
    if (!await field.count()) throw new Error('Hashtag field not found; note UI may have changed');
    await field.fill(tag.replace(/^#/, ''));
    await field.press('Enter');
  }
  return { tags, message: 'Tags entered in browser; verify they persisted before publishing' };
}
