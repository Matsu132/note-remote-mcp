import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createLocalBrowser } from '../dist/src/local-browser.js';

test('keeps login and review windows open and reuses the profile between operations', async () => {
  const profiles = [];
  let signedIn = false;
  let closes = 0;
  const browser = createLocalBrowser(async (profile) => {
    profiles.push(profile);
    const context = new EventEmitter();
    let url = 'about:blank';
    let closed = false;
    const page = {
      goto: async (target) => { url = target; },
      url: () => url,
      isClosed: () => closed,
      bringToFront: async () => {},
      locator: () => ({
        last: () => ({
          waitFor: async () => { if (!signedIn) throw new Error('Editor is absent'); },
        }),
      }),
    };
    context.pages = () => [page];
    context.close = async () => {
      if (closed) return;
      closed = true;
      closes++;
      context.emit('close');
    };
    return context;
  });

  const login = await browser.loginStart();
  assert.equal((await browser.loginFinish(login.sessionId)).authenticated, false);
  assert.equal(closes, 0);
  await assert.rejects(browser.withNotePage(async () => {}), /Close the current/);

  signedIn = true;
  assert.equal((await browser.loginFinish(login.sessionId)).authenticated, true);
  assert.equal(closes, 1);

  const articleUrl = 'https://note.com/author/n/example';
  const review = await browser.withHeldNotePage(articleUrl, async () => ({ reviewed: false }));
  assert.equal(review.editorUrl, articleUrl);
  assert.equal(closes, 1);
  assert.equal(await browser.inHeldSession(review.sessionId, async (page) => page.url()), articleUrl);
  await browser.reviewFinish(review.sessionId);
  assert.equal(closes, 2);
  await assert.rejects(browser.inHeldSession(review.sessionId, async () => {}), /session has ended/);

  await browser.withNotePage(async (page) => assert.equal(page.url(), 'https://note.com/notes/new'));
  assert.equal(closes, 3);
  assert.equal(profiles.length, 3);
  assert.equal(new Set(profiles).size, 1);
});
