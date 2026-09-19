/**
 * Detects whether a response is a WAF/bot-protection challenge rather than a genuine
 * response from the origin site.
 *
 * Why this matters: our probes present bot User-Agents from a non-vendor IP with no
 * request signature — definitionally unverifiable traffic, which is exactly what WAFs
 * challenge. A challenge therefore says nothing about how the origin treats the *real*
 * crawler (which arrives from published vendor IPs and may pass verification). Treating
 * a challenge as "blocked" is a false positive; letting the challenge page fall through
 * to the cloaking comparison is a false MISMATCH.
 */
export interface WafVerdict {
  challenged: boolean;
  /** Vendor name when identifiable, e.g. "cloudflare", "aws-waf". */
  vendor: string | null;
}

const CLOUDFLARE_BODY_MARKERS = /_cf_chl|challenge-platform|cf-browser-verification|just a moment/i;

export function detectWafChallenge(statusCode: number, headers: Headers, body: string): WafVerdict {
  // Definitive Cloudflare signal: only set when a challenge was actually served.
  if (headers.get('cf-mitigated') === 'challenge') {
    return { challenged: true, vendor: 'cloudflare' };
  }

  const behindCloudflare =
    headers.has('cf-ray') || (headers.get('server') ?? '').toLowerCase() === 'cloudflare';
  if (behindCloudflare && (statusCode === 403 || statusCode === 503)) {
    // Managed challenges 403; the JS challenge 503s with a full interstitial page.
    if (body.length === 0 || CLOUDFLARE_BODY_MARKERS.test(body)) {
      return { challenged: true, vendor: 'cloudflare' };
    }
  }

  // AWS WAF exposes its action outcome directly.
  if (headers.has('x-amzn-waf-action')) {
    return { challenged: true, vendor: 'aws-waf' };
  }

  return { challenged: false, vendor: null };
}
