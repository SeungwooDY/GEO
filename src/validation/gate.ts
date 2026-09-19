import type { BusinessProfile } from '../generators/businessProfile.js';
import { checkFacts, type Fact, type FactCheckResult } from './facts.js';
import type { Judge, JudgeResult } from './judge.js';

export type GateStatus = 'pass' | 'reject' | 'review';

export interface GateResult {
  status: GateStatus;
  layer1: FactCheckResult;
  /** Null when layer 1 already rejected (no LLM cost) or no judge ran. */
  layer2: JudgeResult | null;
  /** Human-readable why, for the report and for whoever reviews a held artifact. */
  reasons: string[];
}

export interface GateInput {
  candidate: string;
  /** What the candidate must stay faithful to: a BusinessProfile, or text such as the live human-visible page. */
  source: string | BusinessProfile;
  /** Layer-2 judge. Required unless `requireJudge` is false. */
  judge?: Judge;
  /**
   * Amplify needs both layers (default). Mirror only needs "snapshot matches the human page", so it
   * passes `false` and layer 1 alone decides.
   */
  requireJudge?: boolean;
}

const describeFact = (f: Fact) => `${f.kind} "${f.value}"`;

/**
 * The cloaking-policy gate. Layer 1 (deterministic facts) runs first and short-circuits; layer 2 (LLM judge)
 * covers fuzzy claims. It fails closed: a judge error, an "unsure" verdict, or a missing judge yields "review",
 * never "pass". Only "pass" may be served.
 */
export async function runGate({ candidate, source, judge, requireJudge = true }: GateInput): Promise<GateResult> {
  const layer1 = checkFacts(candidate, source);

  if (!layer1.ok) {
    return { status: 'reject', layer1, layer2: null, reasons: layer1.added.map((f) => `added ${describeFact(f)} not in source`) };
  }
  if (!requireJudge) return { status: 'pass', layer1, layer2: null, reasons: [] };

  if (!judge) {
    return { status: 'review', layer1, layer2: null, reasons: ['no judge configured, so layer 2 could not run'] };
  }

  const sourceText = typeof source === 'string' ? source : JSON.stringify(source, null, 2);
  let layer2: JudgeResult;
  try {
    layer2 = await judge.judge(sourceText, candidate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'review', layer1, layer2: null, reasons: [`judge failed: ${message}`] };
  }

  if (layer2.verdict === 'supported') return { status: 'pass', layer1, layer2, reasons: [] };
  if (layer2.verdict === 'unsupported') {
    return { status: 'reject', layer1, layer2, reasons: layer2.unsupportedClaims.map((c) => `unsupported claim: ${c}`) };
  }
  return { status: 'review', layer1, layer2, reasons: ['judge was unsure'] };
}
