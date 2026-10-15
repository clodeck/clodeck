import { buildApp } from './app.js';
import { createAuthOptions } from './auth/options.js';
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
  // The password is hashed here, once, at boot — or, when unset, the seam is
  // built fail-closed and warns (see `auth/options.ts`). The declared public
  // origin rides along: its scheme is what lets a deployment with no domain
  // keep a session at all (spec-07).
  auth: await createAuthOptions(config.uiPassword, config.publicOrigin),
  // The image sets `WEB_ROOT` (spec-06 §"Ticket 27"); left unset it resolves to
  // a build this checkout made, so null here means there was none to serve — the
  // dev loop, where Vite serves the client instead (spec-07 §"The web root").
  webRoot: config.webRoot,
});

// Loopback by default. It is defense in depth now, not the boundary: the gate
// covers every route and both websockets, so a container can set HOST to bind
// its internal interface without becoming an open one.
//
// `PORT=` (set but empty) is a shell accident, not a request for an ephemeral
// port — `Number('')` is 0, which would bind a random one and leave the dev
// proxy pointing at nothing. The web dev proxy reads the same variable.
const port = Number(process.env['PORT']?.trim() || DEFAULT_PORT);
const host = process.env['HOST'] ?? '127.0.0.1';

await app.listen({ port, host });
console.log(`clodeck server listening on http://${host}:${port}`);
