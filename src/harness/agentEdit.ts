import Anthropic from '@anthropic-ai/sdk';

/**
 * Agent-tier edit, milestone-3-in-miniature: framework layouts (Next/Remix layout.tsx etc.) can't be
 * edited with a string splice the way index.html can, so a Claude edit produces the new file — and a
 * deterministic gate decides whether to accept it. The gate is the safety story:
 *
 *   1. Insertion-only: every original line must appear, unchanged and in order, in the edited file
 *      (the original is a subsequence of the result). The agent can add; it cannot modify or delete.
 *   2. Exact payload: the JSON-LD string must appear verbatim — the facts come from the validated
 *      profile, never from the model.
 *
 * A response that fails either check is discarded and the file is skipped, same as before.
 */

/**
 * True when the original's characters survive, in order and unchanged, in the edited file —
 * i.e. the edit only ADDED characters. Whitespace is ignored on both sides so a legitimate
 * insertion may split a line (JSX insertions into `<body>{children}</body>` must), but changing
 * or deleting any non-whitespace character fails the check.
 */
export function isInsertionOnly(original: string, edited: string): boolean {
  const need = original.replace(/\s+/g, '');
  const have = edited.replace(/\s+/g, '');
  let i = 0;
  for (const ch of have) {
    if (i < need.length && ch === need[i]) i++;
  }
  return i === need.length;
}

const stripFences = (s: string) => s.replace(/^\s*```[a-z]*\n/i, '').replace(/\n```\s*$/i, '').trim();

export interface AgentInsertResult {
  ok: boolean;
  content?: string;
  reason?: string;
}

export async function insertJsonLdWithAgent(
  filePath: string,
  source: string,
  jsonLd: string,
  client: Pick<Anthropic, 'messages'> = new Anthropic(),
): Promise<AgentInsertResult> {
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    system: [
      'You edit one framework layout file to add a JSON-LD structured-data script, changing nothing else.',
      'Rules:',
      '- Insert a <script type="application/ld+json"> element so it renders into the document. In React/Next JSX, use:',
      '  <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />',
      '  where JSON_LD is a template literal containing EXACTLY the JSON given, byte for byte.',
      '- Place it inside the rendered output (inside <body> is fine; JSON-LD is valid anywhere in the document).',
      '- Do not modify, reformat, reorder, or delete ANY existing line. Only add lines.',
      '- Reply with the complete edited file and nothing else: no code fences, no commentary.',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: `File: ${filePath}\n\nJSON to embed (use verbatim):\n${jsonLd}\n\nCurrent file content:\n${source}`,
    }],
  });

  if (response.stop_reason === 'refusal') return { ok: false, reason: 'the edit model refused the request' };
  if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'the edited file was cut off at max_tokens' };

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) return { ok: false, reason: 'the edit model returned no text' };
  const edited = stripFences(text);

  // Verbatim preferred; re-indented-but-identical accepted (whitespace-stripped comparison).
  const carriesPayload = edited.includes(jsonLd) || edited.replace(/\s+/g, '').includes(jsonLd.replace(/\s+/g, ''));
  if (!carriesPayload) return { ok: false, reason: 'gate: edited file does not contain the exact JSON payload' };
  if (!isInsertionOnly(source, edited)) return { ok: false, reason: 'gate: edit was not insertion-only (an existing line changed)' };

  return { ok: true, content: `${edited.trimEnd()}\n` };
}
