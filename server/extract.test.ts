import { describe, expect, it } from 'vitest';
import { parsePage } from './extract.js';
import { isPrivateAddress } from './guard.js';

const PAGE = `<!doctype html><html><head><title>Riverside Plumbing | Home</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"ignored"},
  {"@type":"Plumber","name":"Riverside Plumbing Co.","telephone":"(951) 555-0142",
   "address":{"@type":"PostalAddress","streetAddress":"123 Main St","addressLocality":"Riverside","addressRegion":"CA","postalCode":"92501"},
   "areaServed":["Riverside",{"@type":"City","name":"Corona"}],
   "makesOffer":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"Drain cleaning"}}],
   "openingHoursSpecification":[{"dayOfWeek":["https://schema.org/Monday","Tuesday"],"opens":"07:00:00","closes":"19:00"}],
   "aggregateRating":{"ratingValue":4.8,"reviewCount":120}}
]}</script></head>
<body><a href="/about#team">About</a><a href="/about?utm=1">About again</a><a href="/menu.pdf">pdf</a>
<a href="https://other.com/x">external</a><a href="/contact">Contact</a></body></html>`;

describe('parsePage', () => {
  const facts = parsePage(PAGE, 'https://example.com/');

  it('reads business facts from JSON-LD (including @graph and nested names)', () => {
    expect(facts.profile.name).toBe('Riverside Plumbing Co.');
    expect(facts.profile.phone).toBe('(951) 555-0142');
    expect(facts.profile.address).toEqual({ street: '123 Main St', city: 'Riverside', region: 'CA', postalCode: '92501' });
    expect(facts.profile.areaServed).toEqual(['Riverside', 'Corona']);
    expect(facts.profile.services).toEqual(['Drain cleaning']);
    expect(facts.profile.reviews).toEqual({ ratingValue: 4.8, reviewCount: 120 });
    expect(facts.evidence.name).toBe('JSON-LD');
  });

  it('normalizes schema.org day URLs and HH:MM:SS times', () => {
    expect(facts.profile.hours).toEqual([{ days: ['Monday', 'Tuesday'], opens: '07:00', closes: '19:00' }]);
  });

  it('collects unique same-origin page links only', () => {
    expect(facts.links).toEqual(['https://example.com/', 'https://example.com/about', 'https://example.com/contact']);
  });

  it('with no JSON-LD it falls back to tel: and title, and leaves the rest missing (never guessed)', () => {
    const f = parsePage('<html><head><title>Acme Dental - Home</title></head><body><a href="tel:+19515550142">Call</a></body></html>', 'https://acme.com/');
    expect(f.profile.name).toBe('Acme Dental');
    expect(f.profile.phone).toBe('+19515550142');
    expect(f.profile.address).toBeUndefined();
    expect(f.evidence).toEqual({ phone: 'tel: link', name: 'page title' });
  });

  it('survives malformed JSON-LD', () => {
    const f = parsePage('<script type="application/ld+json">{oops</script><title>X</title>', 'https://x.com/');
    expect(f.profile.name).toBe('X');
  });
});

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});
