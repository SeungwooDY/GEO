export interface BotDefinition {
  /** Token as it appears in robots.txt "User-agent:" lines */
  token: string;
  /** Real UA string the bot sends, used for the UA-diff / cloaking check */
  userAgent: string;
  vendor: string;
}

// UA strings as published by each vendor's crawler documentation.
export const AI_BOTS: BotDefinition[] = [
  {
    token: 'GPTBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
    vendor: 'OpenAI',
  },
  {
    token: 'ChatGPT-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    vendor: 'OpenAI',
  },
  {
    token: 'ClaudeBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com',
    vendor: 'Anthropic',
  },
  {
    token: 'Claude-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    vendor: 'Anthropic',
  },
  {
    token: 'PerplexityBot',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
    vendor: 'Perplexity',
  },
  // Perplexity documents that this user-initiated fetcher may not honor robots.txt.
  {
    token: 'Perplexity-User',
    userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    vendor: 'Perplexity',
  },
  {
    token: 'Google-Extended',
    userAgent: 'Mozilla/5.0 (compatible; Google-Extended)',
    vendor: 'Google',
  },
];

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
