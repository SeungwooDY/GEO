import { readFileSync } from 'node:fs';

export interface HarnessConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  port: number;
  /** Where the installation store (and later run state) lives. */
  dataDir: string;
}

type Env = Record<string, string | undefined>;

/** Accepts the PEM inline (with literal "\n" for newlines, as most env files need) or as a file path. */
function readPrivateKey(env: Env): string | undefined {
  if (env.GITHUB_APP_PRIVATE_KEY_PATH) return readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  return env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

/** Validates the environment up front and reports every problem at once, so setup isn't a fix-one-rerun loop. */
export function loadHarnessConfig(env: Env = process.env): HarnessConfig {
  const problems: string[] = [];

  const appId = env.GITHUB_APP_ID?.trim();
  if (!appId) problems.push('GITHUB_APP_ID is required');

  let privateKey: string | undefined;
  try {
    privateKey = readPrivateKey(env);
  } catch (err) {
    problems.push(`could not read GITHUB_APP_PRIVATE_KEY_PATH: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!privateKey && !problems.some((p) => p.includes('PRIVATE_KEY'))) {
    problems.push('GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required');
  } else if (privateKey && !privateKey.includes('PRIVATE KEY')) {
    problems.push('the GitHub App private key does not look like a PEM file');
  }

  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) problems.push('GITHUB_WEBHOOK_SECRET is required');

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`PORT must be 1-65535, got "${env.PORT}"`);

  if (problems.length > 0) throw new Error(`Invalid harness configuration:\n- ${problems.join('\n- ')}`);

  return { appId: appId!, privateKey: privateKey!, webhookSecret: webhookSecret!, port, dataDir: env.GEO_DATA_DIR || 'data/harness' };
}
