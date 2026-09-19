import type { BusinessProfile } from '../generators/businessProfile.js';

/** The facts behind the mock site's Riverside Plumbing Co. page, used as generator input and as a test fixture. */
export const MOCK_PROFILE: BusinessProfile = {
  name: 'Riverside Plumbing Co.',
  phone: '(951) 555-0142',
  address: { street: '123 Main St', city: 'Riverside', region: 'CA', postalCode: '92501' },
  areaServed: ['Riverside, CA'],
  services: ['Emergency repairs', 'Water heater installation', 'Drain cleaning'],
  hours: [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '07:00', closes: '19:00' }],
  url: 'http://127.0.0.1:4173/',
  reviews: { ratingValue: 4.8, reviewCount: 120 },
};
