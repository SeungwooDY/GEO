import type { BusinessProfile } from './businessProfile.js';
import { formatHoursLine } from './hours.js';

/**
 * Renders a profile as citation-friendly markdown. Template-only by design: every line is built from a
 * profile field, so the output can't assert anything the business didn't tell us (see the cloaking policy in PLAN.md).
 */
export function generateMarkdown(profile: BusinessProfile): string {
  const { address } = profile;
  const lines: string[] = [`# ${profile.name}`, ''];

  if (profile.areaServed.length > 0) {
    lines.push(`${profile.name} serves ${profile.areaServed.join('; ')}.`, '');
  }

  lines.push('## Contact', '');
  lines.push(`- Phone: ${profile.phone}`);
  lines.push(`- Address: ${address.street}, ${address.city}, ${address.region} ${address.postalCode}`);
  if (profile.url) lines.push(`- Website: ${profile.url}`);
  lines.push('');

  if (profile.hours.length > 0) {
    lines.push('## Hours', '');
    for (const entry of profile.hours) lines.push(`- ${formatHoursLine(entry)}`);
    lines.push('');
  }

  if (profile.services.length > 0) {
    lines.push('## Services', '');
    for (const service of profile.services) lines.push(`- ${service}`);
    lines.push('');
  }

  if (profile.reviews) {
    lines.push('## Reviews', '');
    lines.push(`Rated ${profile.reviews.ratingValue} out of 5 from ${profile.reviews.reviewCount} reviews.`, '');
  }

  return lines.join('\n').trimEnd() + '\n';
}
