import { loadHarnessConfig } from './config.js';
import { createGithubApp, describeRepoAccess } from './github.js';

/** `npm run harness:smoke -- owner/repo`: checks the App can authenticate and read a repo it's installed on. */
const target = process.argv[2];
const [owner, name, ...rest] = (target ?? '').split('/');
if (!owner || !name || rest.length > 0) {
  console.error('usage: npm run harness:smoke -- <owner>/<repo>');
  process.exit(2);
}

let config;
try {
  config = loadHarnessConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  const app = createGithubApp(config);
  const access = await describeRepoAccess(app, owner, name);
  console.log(JSON.stringify(access, null, 2));
  console.log('OK: minted an installation token and read the repo.');
} catch (err) {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Is the App installed on this repo, and are the App ID and private key correct?');
  process.exit(1);
}
