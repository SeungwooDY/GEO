import { renderPage } from '../crawlers/renderPage.js';
import { extractVisibleText } from '../crawlers/htmlText.js';
import type { ApprovedStore } from '../store/approvedStore.js';
import { checkFacts } from '../validation/facts.js';
import { runGate, type GateResult } from '../validation/gate.js';

export interface PublishMirrorInput {
  tenant: string;
  path: string;
  /** Full URL of the live human page to snapshot. */
  url: string;
  store: ApprovedStore;
  /** Returns the page's HTML after JavaScript has run. Defaults to headless Chromium; injectable for tests. */
  render?: (url: string) => Promise<string>;
  now?: () => Date;
}

/**
 * Mirror mode: what a bot receives is exactly what a person sees, as a rendered snapshot, so JavaScript-built pages
 * aren't blank to crawlers that don't run JS. No restructuring and no generated text, so there is nothing for a judge
 * to check; the gate only confirms the snapshot's facts match a second, independent render of the live page (which
 * catches a capture that was partial, personalized or mid-update). Stored only on `pass`.
 */
export async function publishMirror({ tenant, path, url, store, render = renderPage, now = () => new Date() }: PublishMirrorInput): Promise<GateResult> {
  const snapshot = await render(url);
  const snapshotText = extractVisibleText(snapshot);

  if (snapshotText === '') {
    const layer1 = checkFacts('', '');
    return { status: 'reject', layer1, layer2: null, reasons: ['snapshot has no visible text (blocked, blank or failed to render)'] };
  }

  const result = await runGate({ candidate: snapshotText, source: extractVisibleText(await render(url)), requireJudge: false });
  if (result.status === 'pass') {
    await store.put({ tenant, path, mode: 'mirror' }, { contentType: 'text/html; charset=utf-8', body: snapshot, approvedAt: now().toISOString() });
  }
  return result;
}
