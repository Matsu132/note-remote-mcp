import Browserbase from '@browserbasehq/sdk';
import { chromium, type Page } from 'playwright-core';

export type PageJob<T> = (page: Page) => Promise<T>;
export function browserbaseClient(): Browserbase {
  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_CONTEXT_ID)
    throw new Error('BROWSERBASE_API_KEY and BROWSERBASE_CONTEXT_ID must be configured');
  return new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
}

function opts(persist = true) {
  return {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserSettings: {
      context: { id: process.env.BROWSERBASE_CONTEXT_ID!, persist },
      recordSession: false,
      logSession: false,
      solveCaptchas: false
    },
    region: 'ap-southeast-1' as const,
    api_timeout: 600
  };
}

function preferPage(pages: Page[]): Page | undefined {
  return pages.find(p => p.url().includes('note.com')) ?? pages[0];
}

function notePageOrCreate(pages: Page[], create: () => Promise<Page>): Promise<Page> {
  const page = preferPage(pages);
  return page ? Promise.resolve(page) : create();
}

export async function loginStart(): Promise<{ sessionId: string; loginUrl: string; expiresAt: string }> {
  const bb = browserbaseClient();
  const session = await bb.sessions.create({ ...opts(true), keepAlive: true });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Cloud browser context not found');
  const page = await notePageOrCreate(context.pages(), () => context.newPage());
  await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });
  const debug = await bb.sessions.debug(session.id, { expiresIn: 600 });
  // Do not close: the user interacts with this session in the Live View.
  const url = debug.debuggerFullscreenUrl ?? debug.debuggerUrl;
  if (!url) throw new Error('Live View unavailable');
  return { sessionId: session.id, loginUrl: url, expiresAt: session.expiresAt };
}

export async function loginFinish(sessionId: string): Promise<{ authenticated: boolean; detail: string }> {
  const bb = browserbaseClient();
  const session = await bb.sessions.retrieve(sessionId);
  if (!session.connectUrl) throw new Error('Login session is no longer available');
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('Cloud browser context not found');
  const page = await notePageOrCreate(ctx.pages(), () => ctx.newPage());
  await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const unauthenticated = /\/login|\/signup/.test(new URL(page.url()).pathname);
  if (unauthenticated) return { authenticated: false, detail: 'Complete note sign-in in the Live View, then call again' };
  await bb.sessions.update(sessionId, { status: 'REQUEST_RELEASE' });
  return { authenticated: true, detail: 'Browser session released; persistent context should retain authentication' };
}

export async function withNotePage<T>(job: PageJob<T>, url = 'https://note.com/notes/new'): Promise<T> {
  const bb = browserbaseClient();
  const session = await bb.sessions.create(opts(true));
  try {
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('Cloud browser context not found');
    const page = await notePageOrCreate(ctx.pages(), () => ctx.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (new URL(page.url()).pathname.startsWith('/login'))
      throw new Error('note.com session expired. Run note_login_start and note_login_finish');
    return await job(page);
  } finally {
    await bb.sessions.update(session.id, { status: 'REQUEST_RELEASE' }).catch(() => {});
  }
}

export async function reviewFinish(sessionId: string): Promise<void> {
  await browserbaseClient().sessions.update(sessionId, { status: 'REQUEST_RELEASE' });
}

/** Hold a Browserbase session open for manual verification; session ID is sensitive. */
export async function withHeldNotePage<T extends object>(url: string, job: PageJob<T>): Promise<T & { sessionId: string; liveViewUrl: string }> {
  const bb = browserbaseClient();
  const session = await bb.sessions.create({ ...opts(true), keepAlive: true });
  try {
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('Cloud browser context not found');
    const page = await notePageOrCreate(ctx.pages(), () => ctx.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('Session expired; login again');
    const result = await job(page);
    const live = await bb.sessions.debug(session.id, { expiresIn: 600 });
    const liveViewUrl = live.debuggerFullscreenUrl ?? live.debuggerUrl;
    if (!liveViewUrl) throw new Error('Could not get Live View');
    return { ...result, sessionId: session.id, liveViewUrl };
  } catch (e) {
    await bb.sessions.update(session.id, { status: 'REQUEST_RELEASE' }).catch(() => {});
    throw e;
  }
}

export async function inHeldSession<T>(sessionId: string, job: PageJob<T>, release = false): Promise<T> {
  const bb = browserbaseClient();
  const session = await bb.sessions.retrieve(sessionId);
  if (!session.connectUrl) throw new Error('Browser session expired, result not known');
  try {
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('Cloud browser context not found');
    const page = await notePageOrCreate(ctx.pages(), () => ctx.newPage());
    if (!page.url().startsWith('https://note.com/')) throw new Error('Review session is not on note.com');
    return await job(page);
  } finally {
    if (release) await bb.sessions.update(sessionId, { status: 'REQUEST_RELEASE' }).catch(() => {});
  }
}
