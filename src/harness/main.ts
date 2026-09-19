import { join } from 'node:path';
import { loadHarnessConfig } from './config.js';
import { createGithubApp } from './github.js';
import { registerInstallationHandlers, type Logger } from './installationEvents.js';
import { FileInstallationStore } from './installations.js';
import { createHarnessServer } from './server.js';

const log: Logger = {
  info: (message, extra) => console.log(`[harness] ${message}`, extra ? JSON.stringify(extra) : ''),
  warn: (message, extra) => console.warn(`[harness] ${message}`, extra ? JSON.stringify(extra) : ''),
  error: (message, extra) => console.error(`[harness] ${message}`, extra ? JSON.stringify(extra) : ''),
};

const config = loadHarnessConfig();
const app = createGithubApp(config);
const store = new FileInstallationStore(join(config.dataDir, 'installations.json'));
registerInstallationHandlers(app.webhooks, store, log);

// Loopback only: the tunnel (or a reverse proxy) is the public face, never this socket.
createHarnessServer(app, log).listen(config.port, '127.0.0.1', () => {
  log.info(`listening on http://127.0.0.1:${config.port}/webhook (health: /healthz)`);
});
