import { describe, expect, it } from 'vitest';
import { MOCK_PROFILE } from '../mock-site/profile.js';
import type { Suggestion } from '../suggestions/suggestionEngine.js';
import { HARD_CONSTRAINTS, toChangeSpec } from './changeSpec.js';

const repo = { owner: 'acme', name: 'site', baseBranch: 'main' };

function suggestion(id: string, task: Suggestion['task'], overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    checkId: 'schema',
    severity: 'high',
    finding: `finding for ${id}`,
    action: `action for ${id}`,
    evidence: { key: id },
    task,
    measurable: 'metric',
    ...overrides,
  };
}

const base = { runId: 'run-1', siteUrl: 'https://example.com/', repo };

describe('toChangeSpec', () => {
  it('turns PR-eligible suggestions into tasks, carrying evidence and the measurable', () => {
    const { spec, skipped } = toChangeSpec({
      ...base,
      suggestions: [suggestion('schema.missing', 'add-jsonld'), suggestion('robots.blocked.wildcard', 'robots-rules')],
    });

    expect(skipped).toEqual([]);
    expect(spec.tasks.map((t) => [t.suggestionId, t.type])).toEqual([
      ['schema.missing', 'add-jsonld'],
      ['robots.blocked.wildcard', 'robots-rules'],
    ]);
    expect(spec.tasks[0]).toMatchObject({ evidence: { key: 'schema.missing' }, measurable: 'metric', severity: 'high' });
    expect(spec).toMatchObject({ runId: 'run-1', siteUrl: 'https://example.com/', repo });
  });

  it('skips tasks that cannot be a repo change, each with its own reason', () => {
    const { spec, skipped } = toChangeSpec({
      ...base,
      suggestions: [
        suggestion('uaDiff.wafChallenged', 'check-waf-settings'),
        suggestion('uaDiff.contentDiffers', 'align-bot-content'),
        suggestion('renderingGap.jsDependent', 'prerender'),
        suggestion('content.thin', 'enrich-content'),
        suggestion('uaDiff.originBlocked', null),
      ],
    });

    expect(spec.tasks).toEqual([]);
    expect(skipped.map((s) => s.suggestionId)).toEqual([
      'uaDiff.wafChallenged',
      'uaDiff.contentDiffers',
      'renderingGap.jsDependent',
      'content.thin',
      'uaDiff.originBlocked',
    ]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
    expect(skipped[0].reason).toContain('WAF');
    expect(skipped[4].reason).toContain('report-only');
  });

  it('only includes suggestions a person approved when approvedIds is given', () => {
    const { spec, skipped } = toChangeSpec({
      ...base,
      suggestions: [suggestion('schema.missing', 'add-jsonld'), suggestion('schema.napMismatch', 'align-nap')],
      approvedIds: ['schema.napMismatch'],
    });

    expect(spec.tasks.map((t) => t.suggestionId)).toEqual(['schema.napMismatch']);
    expect(skipped).toEqual([{ suggestionId: 'schema.missing', reason: 'not approved' }]);
  });

  it('treats everything as approved when approvedIds is omitted, but an empty list approves nothing', () => {
    const suggestions = [suggestion('schema.missing', 'add-jsonld')];
    expect(toChangeSpec({ ...base, suggestions }).spec.tasks).toHaveLength(1);
    expect(toChangeSpec({ ...base, suggestions, approvedIds: [] }).spec.tasks).toHaveLength(0);
  });

  it('carries supplied business facts, or null when there are none', () => {
    const suggestions = [suggestion('schema.missing', 'add-jsonld')];
    expect(toChangeSpec({ ...base, suggestions, businessFacts: MOCK_PROFILE }).spec.businessFacts).toEqual(MOCK_PROFILE);
    expect(toChangeSpec({ ...base, suggestions }).spec.businessFacts).toBeNull();
  });

  it('always attaches the hard constraints, as a copy callers cannot use to weaken the originals', () => {
    const { spec } = toChangeSpec({ ...base, suggestions: [] });
    expect(spec.constraints).toEqual([...HARD_CONSTRAINTS]);
    expect(spec.constraints).not.toBe(HARD_CONSTRAINTS);
    expect(spec.constraints.join(' ')).toMatch(/never push/i);
    expect(spec.constraints.join(' ')).toMatch(/cloaking/i);
  });
});
