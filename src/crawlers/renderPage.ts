import { chromium } from 'playwright';
import { BROWSER_USER_AGENT } from './botUserAgents.js';

/** Loads a URL in headless Chromium and returns the HTML after client-side JavaScript has run: what a person actually sees. */
export async function renderPage(url: string, userAgent = BROWSER_USER_AGENT): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent });
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    // Big sites (ads/analytics) never reach network idle; give JS a bounded window to render, then move on.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}
