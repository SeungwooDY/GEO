import type { BusinessProfile } from '../generators/businessProfile.js';
import type { Severity, Suggestion, TaskType } from '../suggestions/suggestionEngine.js';

/**
 * The change spec: the structured input to the GitHub App's agent run. The suggestions engine's output is
 * narrowed to what can be delivered as a repo change; the agent never receives free-text instructions.
 */

/** Suggestion task types that can be delivered as a repo edit. Everything else stays report-only. */
export const PR_TASK_TYPES = ['robots-rules', 'add-jsonld', 'complete-jsonld', 'align-nap'] as const;
export type PrTaskType = (typeof PR_TASK_TYPES)[number];

export interface RepoRef {
  owner: string;
  name: string;
  /** Branch the PR targets. The App never pushes to it. */
  baseBranch: string;
}

export interface ChangeTask {
  /** The suggestion rule id this task came from, e.g. "schema.missing". Also the idempotency key for PRs. */
  suggestionId: string;
  type: PrTaskType;
  severity: Severity;
  finding: string;
  action: string;
  /** Straight from the diagnostic: which bots, which fields, which numbers. */
  evidence: Record<string, unknown>;
  /** The metric re-measured after merge for the before/after story. */
  measurable: string;
}

export interface ChangeSpec {
  runId: string;
  siteUrl: string;
  repo: RepoRef;
  tasks: ChangeTask[];
  /**
   * Facts the business supplied. When absent, the agent may only use facts already visible in the repo or on
   * the page, and must leave a TODO in the PR body for anything missing rather than inventing it.
   */
  businessFacts: BusinessProfile | null;
  constraints: string[];
}

export interface SkippedSuggestion {
  suggestionId: string;
  reason: string;
}

export interface ChangeSpecResult {
  spec: ChangeSpec;
  skipped: SkippedSuggestion[];
}

/** The standing guardrails, rendered into the agent's system prompt and re-checked by the post-run gate. */
export const HARD_CONSTRAINTS: readonly string[] = [
  'Open a pull request from a new branch. Never push to the base branch.',
  'Make the smallest diff that completes each task. Do not reformat or refactor unrelated code.',
  'Only edit files needed for the listed tasks.',
  'Cloaking policy: content served to bots must carry the same substance as what people see, in a cleaner format. Never add claims or facts that a human visitor cannot see.',
  'Only use business facts from businessFacts, the repository, or the live page. Never invent a phone number, address, hours, price, rating, or claim. If a fact is missing, leave a TODO and say so in the PR body.',
];

const REPORT_ONLY_REASONS: Partial<Record<Exclude<TaskType, null>, string>> = {
  'check-waf-settings': 'a WAF setting lives outside the repo',
  'align-bot-content': 'only applies to the proxy, not to repo content',
  prerender: 'needs a framework-level change that cannot be done safely without running a build',
  'enrich-content': 'needs new copy and facts the business must supply',
};

export interface ToChangeSpecInput {
  runId: string;
  siteUrl: string;
  repo: RepoRef;
  suggestions: Suggestion[];
  /** Suggestion ids a person approved in the dashboard. Omit to treat every suggestion as approved. */
  approvedIds?: readonly string[];
  businessFacts?: BusinessProfile;
}

const isPrTaskType = (task: TaskType): task is PrTaskType => (PR_TASK_TYPES as readonly (string | null)[]).includes(task);

export function toChangeSpec(input: ToChangeSpecInput): ChangeSpecResult {
  const approved = input.approvedIds ? new Set(input.approvedIds) : null;
  const tasks: ChangeTask[] = [];
  const skipped: SkippedSuggestion[] = [];

  for (const s of input.suggestions) {
    if (approved && !approved.has(s.id)) {
      skipped.push({ suggestionId: s.id, reason: 'not approved' });
    } else if (s.task === null) {
      skipped.push({ suggestionId: s.id, reason: 'report-only finding, no automated change' });
    } else if (!isPrTaskType(s.task)) {
      skipped.push({ suggestionId: s.id, reason: `report-only: ${REPORT_ONLY_REASONS[s.task] ?? `${s.task} is not delivered as a PR`}` });
    } else {
      tasks.push({
        suggestionId: s.id,
        type: s.task,
        severity: s.severity,
        finding: s.finding,
        action: s.action,
        evidence: s.evidence,
        measurable: s.measurable,
      });
    }
  }

  return {
    spec: {
      runId: input.runId,
      siteUrl: input.siteUrl,
      repo: input.repo,
      tasks,
      businessFacts: input.businessFacts ?? null,
      constraints: [...HARD_CONSTRAINTS],
    },
    skipped,
  };
}
