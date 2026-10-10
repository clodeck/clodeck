import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createProjectDiscovery } from './discovery.js';
import { createAnthropicProvider } from './sdk/anthropic.js';
import { createNodePtySpawner } from './terminal/node-pty-spawner.js';

const DEFAULT_PORT = 3001;

const config = loadConfig();
const app = buildApp({
  projects: createProjectDiscovery(config.projectsRoot),
  provider: createAnthropicProvider(),
  // The one place the real node-pty binding is reached; tests inject the fake.
  spawner: createNodePtySpawner(),
});

// Loopback by default: this slice serves `/api/**` unauthenticated, so it must
// not be reachable from the network until the auth slice lands. A container
// sets HOST to bind its internal interface.
const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const host = process.env['HOST'] ?? '127.0.0.1';

await app.listen({ port, host });
console.log(`clodeck server listening on http://${host}:${port}`);
