import { AI_BOTS } from './botUserAgents.js';
import type { RobotsReport, RobotsRuleResult } from './types.js';

interface Rule {
  type: 'allow' | 'disallow';
  path: string;
}

type Groups = Map<string, Rule[]>;

/** Parses robots.txt into per-user-agent rule groups (RFC 9309 shape, no crawl-delay/sitemap handling needed here). */
function parseGroups(robotsTxt: string): Groups {
  const groups: Groups = new Map();
  let currentAgents: string[] = [];
  let sawRuleSinceLastAgent = true;

  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      const token = value.toLowerCase();
      if (sawRuleSinceLastAgent) {
        // Starting a fresh group.
        currentAgents = [token];
        sawRuleSinceLastAgent = false;
      } else {
        // Consecutive User-agent lines belong to the same group.
        currentAgents.push(token);
      }
      for (const agent of currentAgents) {
        if (!groups.has(agent)) groups.set(agent, []);
      }
    } else if (key === 'allow' || key === 'disallow') {
      sawRuleSinceLastAgent = true;
      for (const agent of currentAgents) {
        groups.get(agent)?.push({ type: key, path: value });
      }
    }
  }

  return groups;
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false; // empty Disallow means "allow everything"
  // Translate robots.txt wildcard syntax (* and trailing $) to a regex.
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp(`^${escaped}`).test(path);
}

function evaluate(groups: Groups, token: string, path: string): RobotsRuleResult {
  const lowerToken = token.toLowerCase();
  const hasExplicitEntry = groups.has(lowerToken);
  const rules = groups.get(lowerToken) ?? groups.get('*') ?? [];

  // Longest matching path wins; Allow beats Disallow on a tie (standard robots.txt precedence).
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length) {
      best = rule;
    } else if (rule.path.length === best.path.length && rule.type === 'allow') {
      best = rule;
    }
  }

  return {
    bot: token,
    allowedTargetPath: best ? best.type === 'allow' : true,
    matchedRule: best ? `${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.path}` : null,
    hasExplicitEntry,
  };
}

export async function checkRobots(baseUrl: string, targetPath: string): Promise<RobotsReport> {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  let robotsTxt = '';
  let robotsTxtFound = false;

  try {
    const res = await fetch(robotsUrl);
    if (res.ok) {
      robotsTxt = await res.text();
      robotsTxtFound = true;
    }
  } catch {
    // treated as not found below
  }

  const groups = parseGroups(robotsTxt);
  const perBot = AI_BOTS.map((bot) => evaluate(groups, bot.token, targetPath));

  return { robotsTxtFound, targetPath, perBot };
}
