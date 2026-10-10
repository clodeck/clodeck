import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ProjectDiscovery } from './discovery.js';
import { registerFileRoutes } from './files/transport.js';
import type { SdkProvider } from './sdk/provider.js';
import { registerSessionRoutes } from './sessions.js';
import { createTerminalManager } from './terminal/manager.js';
import type { PtySpawner } from './terminal/pty.js';
import { registerTerminalSizeRoute, registerTerminalSocket } from './terminal/transport.js';
import { registerWsBus } from './ws/bus.js';
import { createTurnManager } from './ws/turn-manager.js';

export interface AppOptions {
  /** The only filesystem reader the routes are given (wayfinder 05 §7). */
  projects: ProjectDiscovery;
  /**
   * The only SDK the routes are given. Taking it here — rather than letting a
   * route reach for the SDK — is what lets the whole app run against the
   * scripted fake, with no API key and no network (spec-02 §Testing).
   */
  provider: SdkProvider;
  /**
   * The only pty the routes are given (spec-03 §"The pty facade"). node-pty is a
   * native binding, so — like the SDK — it is injected here and the whole app
   * runs against the scripted fake with no real shell (spec-03 §Testing).
   */
  spawner: PtySpawner;
}

/**
 * The HTTP surface, as a Fastify instance that is *not* listening — callers
 * (tests, `main.ts`) decide when to listen, so the same instance is testable
 * through `inject()`.
 *
 * In this slice every route is unauthenticated. `/api/**` is registered as its
 * own encapsulated scope so the principal-aware hook from wayfinder 07 drops
 * in front of it (and `/ws**` alongside it) without rework.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  // Registered exactly once, here: Fastify throws if the same plugin is added
  // twice, and both `/ws` and `/ws/terminal` need its `websocket: true` handling.
  // That handling is an `onRoute` hook, so it must load before any WS route.
  app.register(websocket);

  const terminals = createTerminalManager(options.spawner);

  // Auth-exempt: used by the proxy's and Docker's healthchecks (wayfinder 08).
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.register(
    async (api) => {
      api.get('/projects', async () => ({ projects: await options.projects.listProjects() }));
      registerSessionRoutes(api, { projects: options.projects, provider: options.provider });
      registerTerminalSizeRoute(api, { projects: options.projects, terminals });
      registerFileRoutes(api, { projects: options.projects });
    },
    { prefix: '/api' },
  );

  registerWsBus(app, { projects: options.projects, turns: createTurnManager(options.provider) });
  // The raw-byte sibling of `/ws`, on the same instance — no second server.
  registerTerminalSocket(app, { projects: options.projects, terminals });

  return app;
}
