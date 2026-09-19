import { AI_BOTS } from '../crawlers/botUserAgents.js';
import type { DeliveryMode } from '../mode.js';
import type { BusinessProfile } from './businessProfile.js';

/**
 * robots.txt groups for the AI bots (every entry in AI_BOTS, including token-only ones like Google-Extended,
 * which robots.txt is the only lever for). Cloak disallows everything; the other modes allow everything.
 * This is a section to merge into a site's robots.txt, not a whole file — it deliberately says nothing about `*`.
 */
export function generateAiBotRobots(mode: DeliveryMode): string {
  const rule = mode === 'cloak' ? 'Disallow: /' : 'Allow: /';
  return AI_BOTS.map((bot) => `User-agent: ${bot.token}\n${rule}`).join('\n\n') + '\n';
}

/**
 * llms.txt is nearly free to generate, but no major crawler currently honors it — don't sell it as impact.
 * Built only from profile fields, like the other generators.
 */
export function generateLlmsTxt(profile: BusinessProfile): string {
  const lines: string[] = [`# ${profile.name}`, ''];

  const summary = [`Local business at ${profile.address.street}, ${profile.address.city}, ${profile.address.region}.`, `Phone: ${profile.phone}.`];
  lines.push(`> ${summary.join(' ')}`, '');

  if (profile.services.length > 0) {
    lines.push('## Services', '');
    for (const service of profile.services) lines.push(`- ${service}`);
    lines.push('');
  }

  if (profile.areaServed.length > 0) {
    lines.push('## Service area', '');
    for (const area of profile.areaServed) lines.push(`- ${area}`);
    lines.push('');
  }

  if (profile.url) lines.push('## Links', '', `- [Website](${profile.url})`, '');

  return lines.join('\n').trimEnd() + '\n';
}
