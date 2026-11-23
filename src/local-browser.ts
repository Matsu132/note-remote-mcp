import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { PageJob } from './browser.js';

const editor = 'https://note.com/notes/new';

type Session = {
  id: string;
  kind: 'login' | 'review' | 'operation';
  context: BrowserContext;
  page: Page;
};

function isNotePage(page: Page): boolean {
  return new URL(page.url()).origin === 'https://note.com';
}

async function editorIsReady(page: Page): Promise<boolean> {
  try {
    await page.locator('[contenteditable="true"]').last().waitFor({ state: 'visible', timeout: 8_000 });
    return isNotePage(page) && new URL(page.url()).pathname.replace(/\/$/, '') === '/notes/new';
  } catch {
    return false;
  }
}

function launchChrome(profile: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false });
}

export function createLocalBrowser(launch = launchChrome) {
  let active: Session | undefined;
  let opening: Promise<Session> | undefined;
  let busy = false;

  async function open(kind: Session['kind']): Promise<Session> {
    if (active || opening) throw new Error('Close the current local login or review window before starting another operation');
    const profile = resolve(process.env.NOTE_BROWSER_PROFILE_DIR || join(homedir(), '.note-remote-mcp', 'chromium'));
    opening = (async () => {
      const context = await launch(profile);
      try {
        const page = context.pages()[0] ?? await context.newPage();
        const session = { id: randomUUID(), kind, context, page };
        active = session;
        context.once('close', () => {
          if (active === session) active = undefined;
        });
        return session;
      } catch (error) {
        await context.close();
        throw error;
      }
    })();
    try {
      return await opening;
    } finally {
      opening = undefined;
    }
  }

  async function close(session: Session): Promise<void> {
    await session.context.close();
  }

  function held(id: string, kind: Session['kind']): Session {
    if (!active || active.id !== id || active.kind !== kind || active.page.isClosed())
      throw new Error('Local browser session has ended. Open a new login or review window');
    return active;
  }

  async function exclusive<T>(job: () => Promise<T>): Promise<T> {
    if (busy) throw new Error('Another local browser operation is running');
    busy = true;
    try {
      return await job();
    } finally {
      busy = false;
    }
  }

  async function navigate(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async function openArticle(page: Page, url: string): Promise<void> {
    await navigate(page, url);
    if (!isNotePage(page) || /^\/(?:login|signup)(?:\/|$)/.test(new URL(page.url()).pathname))
      throw new Error('note.com session expired. Run note_login_start and note_login_finish');
  }

  return {
    async loginStart() {
      return exclusive(async () => {
        const session = await open('login');
        try {
          await navigate(session.page, 'https://note.com/login');
          await session.page.bringToFront();
          return {
            sessionId: session.id,
            message: 'Use the Chrome window to sign in if needed, then call note_login_finish',
          };
        } catch (error) {
          await close(session);
          throw error;
        }
      });
    },

    async loginFinish(id: string) {
      return exclusive(async () => {
        const session = held(id, 'login');
        await navigate(session.page, editor);
        if (!await editorIsReady(session.page)) {
          return { authenticated: false, detail: 'Complete note sign-in in the Chrome window, then call again' };
        }
        await close(session);
        return { authenticated: true, detail: 'Sign-in saved in the dedicated Chrome profile' };
      });
    },

    async withNotePage<T>(job: PageJob<T>, url = editor): Promise<T> {
      return exclusive(async () => {
        const session = await open('operation');
        try {
          await openArticle(session.page, url);
          if (url === editor && !await editorIsReady(session.page))
            throw new Error('note.com editor did not open. Verify your sign-in and try again');
          return await job(session.page);
        } finally {
          await close(session);
        }
      });
    },

    async withHeldNotePage<T extends object>(url: string, job: PageJob<T>) {
      return exclusive(async () => {
        const session = await open('review');
        try {
          await openArticle(session.page, url);
          const result = await job(session.page);
          await session.page.bringToFront();
          return { ...result, sessionId: session.id, reviewMode: 'local', editorUrl: session.page.url() };
        } catch (error) {
          await close(session);
          throw error;
        }
      });
    },

    async inHeldSession<T>(id: string, job: PageJob<T>, release = false): Promise<T> {
      return exclusive(async () => {
        const session = held(id, 'review');
        if (!isNotePage(session.page)) throw new Error('Review window is not on note.com');
        try {
          return await job(session.page);
        } finally {
          if (release) await close(session);
        }
      });
    },

    async reviewFinish(id: string): Promise<void> {
      await exclusive(() => close(held(id, 'review')));
    },

    async shutdown(): Promise<void> {
      const session = opening ? await opening.catch(() => undefined) : active;
      if (session) await close(session);
    },
  };
}
