import type { BusinessProfile } from './businessProfile.js';

/** Builds a schema.org LocalBusiness object using only fields present in the profile. */
export function generateSchema(profile: BusinessProfile): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: profile.name,
    telephone: profile.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: profile.address.street,
      addressLocality: profile.address.city,
      addressRegion: profile.address.region,
      postalCode: profile.address.postalCode,
    },
  };

  if (profile.url) schema.url = profile.url;
  if (profile.areaServed.length > 0) schema.areaServed = profile.areaServed;

  if (profile.hours.length > 0) {
    schema.openingHoursSpecification = profile.hours.map((entry) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: entry.days,
      opens: entry.opens,
      closes: entry.closes,
    }));
  }

  if (profile.services.length > 0) {
    schema.makesOffer = profile.services.map((service) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: service },
    }));
  }

  if (profile.reviews) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: profile.reviews.ratingValue,
      reviewCount: profile.reviews.reviewCount,
    };
  }

  return schema;
}

/** Renders the schema as an embeddable script tag; "<" is escaped so profile text can't close the tag early. */
export function renderJsonLdScript(schema: Record<string, unknown>): string {
  const json = JSON.stringify(schema, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
