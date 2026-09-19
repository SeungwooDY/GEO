import type { ApprovedStore } from '../store/approvedStore.js';
import { checkFacts } from '../validation/facts.js';
import { runGate, type GateResult } from '../validation/gate.js';
import type { Judge } from '../validation/judge.js';
import type { BusinessProfile } from './businessProfile.js';
import { generateMarkdown } from './markdownGenerator.js';
import { generateSchema } from './schemaGenerator.js';

/** What an Amplify-mode bot receives: the markdown page plus the same facts as a fenced JSON-LD block. */
export function buildAmplifyArtifact(profile: BusinessProfile): { contentType: string; body: string } {
  const jsonLd = JSON.stringify(generateSchema(profile), null, 2);
  return {
    contentType: 'text/markdown; charset=utf-8',
    body: `${generateMarkdown(profile)}\n## Structured data\n\n\`\`\`json\n${jsonLd}\n\`\`\`\n`,
  };
}

export interface PublishAmplifyInput {
  tenant: string;
  path: string;
  profile: BusinessProfile;
  store: ApprovedStore;
  judge?: Judge;
  /**
   * Visible text of the live human page (rendered, so JS-built content counts). The gate checks the artifact against
   * the profile, but the cloaking policy is about the human page: when this is given, any fact in the artifact that
   * the human page doesn't show is rejected, so bots can never be told something people can't read.
   */
  humanPageText?: string;
  /** Set false to skip the LLM layer (demos and offline runs). The result is then only as strong as the fact checks. Default true. */
  requireJudge?: boolean;
  now?: () => Date;
}

/**
 * Generates the Amplify artifact, runs it through the full two-layer gate, and stores it only on `pass`.
 * On `reject` or `review` nothing is written, so whatever was approved before keeps being served.
 */
export async function publishAmplify({ tenant, path, profile, store, judge, humanPageText, requireJudge, now = () => new Date() }: PublishAmplifyInput): Promise<GateResult> {
  const artifact = buildAmplifyArtifact(profile);

  if (humanPageText !== undefined) {
    const policy = checkFacts(artifact.body, humanPageText);
    // The site's own address is visible in the address bar even if the page text never spells it out.
    const ownUrl = profile.url?.replace(/\/+$/, '').toLowerCase();
    const added = policy.added.filter((f) => !(f.kind === 'url' && f.value === ownUrl));
    if (added.length > 0) {
      return {
        status: 'reject',
        layer1: { ok: false, added, omitted: policy.omitted },
        layer2: null,
        reasons: added.map((f) => `${f.kind} "${f.value}" is not on the human-visible page`),
      };
    }
  }

  const result = await runGate({ candidate: artifact.body, source: profile, judge, requireJudge });

  if (result.status === 'pass') {
    await store.put({ tenant, path, mode: 'amplify' }, { ...artifact, approvedAt: now().toISOString() });
  }
  return result;
}
