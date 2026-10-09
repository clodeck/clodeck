import Fastify, { type FastifyInstance } from 'fastify';

import type { ProjectDiscovery } from './discovery.js';

export interface AppOptions {
  /** The only filesystem reader the routes are given (wayfinder 05 §7). */
  projects: ProjectDiscovery;
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

  // Auth-exempt: used by the proxy's and Docker's healthchecks (wayfinder 08).
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.register(
    async (api) => {
      api.get('/projects', async () => ({ projects: await options.projects.listProjects() }));
    },
    { prefix: '/api' },
  );

  return app;
}
