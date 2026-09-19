export interface BotDefinition {
  /** Token as it appears in robots.txt "User-agent:" lines */
  token: string;
  /** Real UA string the bot sends, used for the UA-diff / cloaking check */
  userAgent: string;
  vendor: string;
  /** True for robots.txt-only policy tokens that never make requests, so there's nothing to fetch as. */
  tokenOnly?: boolean;
  /** Vendor-published JSON files of the IP ranges this bot crawls from, used to verify a claimed UA. */
  ipRangeUrls?: string[];
}

export const fetchableBots = (bots: BotDefinition[]) => bots.filter((b) => !b.tokenOnly);

// Tokens, UA strings and IP-range URLs checked against each vendor's crawler docs (OpenAI, Perplexity, Anthropic).
// Anthropic documents tokens and a single shared IP list for all its bots, but no full UA strings: the three Claude
// UA strings below are modelled on the documented pattern and only their tokens are confirmed. Matching keys on tokens.
const ANTHROPIC_IP_RANGES = ['https://claude.com/crawling/bots.json'];

export const AI_BOTS: BotDefinition[] = [
  {
    token: 'GPTBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    vendor: 'OpenAI',
    ipRangeUrls: ['https://openai.com/gptbot.json'],
  },
  {
    token: 'OAI-SearchBot',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    vendor: 'OpenAI',
    ipRangeUrls: ['https://openai.com/searchbot.json'],
  },
  {
    token: 'ChatGPT-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    vendor: 'OpenAI',
    ipRangeUrls: ['https://openai.com/chatgpt-user.json'],
  },
  {
    token: 'ClaudeBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com',
    vendor: 'Anthropic',
    ipRangeUrls: ANTHROPIC_IP_RANGES,
  },
  {
    token: 'Claude-SearchBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
    vendor: 'Anthropic',
    ipRangeUrls: ANTHROPIC_IP_RANGES,
  },
  {
    token: 'Claude-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    vendor: 'Anthropic',
    ipRangeUrls: ANTHROPIC_IP_RANGES,
  },
  {
    token: 'PerplexityBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    vendor: 'Perplexity',
    ipRangeUrls: ['https://www.perplexity.com/perplexitybot.json'],
  },
  // Perplexity documents that this user-initiated fetcher may not honor robots.txt.
  {
    token: 'Perplexity-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    vendor: 'Perplexity',
    ipRangeUrls: ['https://www.perplexity.com/perplexity-user.json'],
  },
  {
    token: 'Google-Extended',
    userAgent: 'Mozilla/5.0 (compatible; Google-Extended)',
    vendor: 'Google',
    tokenOnly: true,
  },
];

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
