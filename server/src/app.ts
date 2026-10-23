import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { BuildStamp, PermissionMode } from '@clodeck/shared';

import { createAuthGate, registerAuthMeRoute, registerAuthRoutes, type AuthOptions } from './auth/transport.js';
import { registerCommandRoutes } from './commands.js';
import type { ProjectDiscovery } from './discovery.js';
import { registerFileRoutes } from './files/transport.js';
import type { Log } from './logging.js';
import { registerProjectRoutes } from './projects.js';
import { registerProfileRoutes, type ProviderProfiles } from './profiles.js';
import type { SdkProvider } from './sdk/provider.js';
import { registerSessionRoutes } from './sessions.js';
import { registerStaticClient } from './static.js';
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
   * The profiles a session may choose between, read once at boot and handed
   * over whole: the route serves the list this value was built from, and a
   * `send_prompt` resolves its name against the same one, so neither can see a
   * set the other does not (spec-08 §"The provider module").
   */
  profiles: ProviderProfiles;
  /**
   * The only pty the routes are given (spec-03 §"The pty facade"). node-pty is a
   * native binding, so — like the SDK — it is injected here and the whole app
   * runs against the scripted fake with no real shell (spec-03 §Testing).
   */
  spawner: PtySpawner;
  /**
   * The credential, the session store, and the login limiter's tuning — the
   * fourth and last injected seam (spec-05 §"The seam"). There is no null to
   * pass: "no password configured" is a verifier that refuses everything, not
   * an app without a gate. `webRoot` is not a fifth seam: it is configuration
   * (a path to a build artifact), not a facade with a fake behind it.
   */
  auth: AuthOptions;
  /**
   * The built web client's directory, or `null` for "this server serves no
   * client" — the Vite dev loop, and every suite that is not about the bundle.
   * Configuration, not a seam: it is a path, and there is nothing behind it to
   * fake.
   */
  webRoot: string | null;
  /**
   * Which build is running, read once at boot from the artifact beside the
   * server's own code (ADR 0004). Configuration, like `webRoot`: a fact about
   * this artifact that `main.ts` reads, never something the HTTP layer looks up
   * — `/healthz` must answer from the build the process started from, not from
   * the checkout it happens to be near.
   */
  build: BuildStamp;
  /**
   * The proxies whose `X-Forwarded-For` the app believes, as the loader checked
   * and normalized it (`CLODECK_TRUSTED_PROXIES`), or `null` for "trust nothing"
   * (ticket 65). Configuration, not a seam, and the same shape as `webRoot`: it
   * is a fact about this deployment that nothing behind it can supply. It
   * reaches `request.ip` — the address every address-keyed decision reads, and
   * today that is the login limiter alone. Fastify's `trustProxy` reaches two
   * more: `request.host` and `request.protocol` follow a trusted peer's
   * `X-Forwarded-Host` and `-Proto`. Both are inert here — the handshake guard
   * compares the raw `Host` header, and the cookie's flag follows the declared
   * public origin rather than the request — but a later decision that read
   * either would be deciding on a header a declared peer can set.
   *
   * It arrives here already usable on purpose: Fastify compiles the value while
   * building the server and throws on one it cannot read, so a misdeclared list
   * is turned into a warning and "trust nothing" by `trusted-proxies.ts`, at the
   * door every config comes through, rather than into a server that will not
   * start.
   */
  trustedProxies: string | null;
  /**
   * The permission mode a session starts in when it has chosen none, and the
   * one a New chat returns to — `CLODECK_PERMISSION_MODE`, read at boot
   * (ticket 82). Configuration, like `webRoot`: a fact about this deployment,
   * not a facade with a fake behind it.
   */
  permissionMode: PermissionMode;
  /**
   * Whether **Bypass** may be chosen at all — `CLODECK_ALLOW_BYPASS`, read at
   * boot (ticket 85). Configuration, like `permissionMode`: the deployment's
   * gate, which a project's own settings can tighten but never open. The bus
   * combines it with each project's file and the run refuses the mode when the
   * two say no.
   */
  allowBypass: boolean;
  /**
   * Where a line about a run goes — the profile and model a turn actually used,
   * which is the only record of a choice that is otherwise client state
   * (spec-08 §"Testing"). Defaults to the console, so `main.ts` says nothing
   * about it and only a suite that asserts the line injects one.
   */
  log?: Log;
}

/**
 * The HTTP surface, as a Fastify instance that is *not* listening — callers
 * (tests, `main.ts`) decide when to listen, so the same instance is testable
 * through `inject()`.
 *
 * Everything is authenticated except `/healthz` and the two login routes. The
 * gate is an `onRequest` hook, and a hook belongs to an encapsulation scope and
 * applies to *every* route in it — Fastify resolves a scope's hooks when the
 * tree is ready, so "add the hook between two routes" gates both. The exempt
 * routes are therefore exempt by *where* they are registered: on the `/api`
 * scope itself, with the gated routes one scope deeper.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  // `undefined` is Fastify's "nothing is trusted", which is the absence of a
  // list rather than an empty one: `request.ip` stays the peer address, exactly
  // as it was before the variable existed.
  const app = Fastify({ logger: false, trustProxy: options.trustedProxies ?? undefined });

  // Registered exactly once, here: Fastify throws if the same plugin is added
  // twice, and both `/ws` and `/ws/terminal` need its `websocket: true` handling.
  // That handling is an `onRoute` hook, so it must load before any WS route.
  app.register(websocket);

  // Root, and before the gate: its own `onRequest` parses `request.cookies`, and
  // a child scope's hooks run after its parent's — so the gate (and the session
  // routes) always see parsed cookies.
  app.register(cookie);

  const terminals = createTerminalManager(options.spawner);
  // One run state for the process: the session routes ask it what a turn is
  // writing (a delete must not remove that transcript), and the bus drives it.
  const turns = createTurnManager(options.provider, {
    log: options.log,
    permissionMode: options.permissionMode,
  });

  // Auth-exempt: used by the proxy's and Docker's healthchecks (wayfinder 08),
  // and the one place the running build names itself (ADR 0004). `status` stays
  // the **first** key: the setup and deploy scripts match this body with
  // `grep -q '"status":"ok"'`, so a reordered payload would read as a dead
  // server. `no-store` keeps a proxy or a browser from answering with a stamp
  // the process has already replaced.
  app.get('/healthz', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok' as const, build: options.build };
  });

  app.register(
    async (api) => {
      // Exempt: the two routes that make a session possible. `registerAuthRoutes`
      // adds no hook of its own, so this scope stays open.
      registerAuthRoutes(api, options.auth);

      // Gated: one scope deeper. Everything registered in here is behind the
      // gate, `/auth/me` included.
      api.register(async (gated) => {
        gated.addHook('onRequest', createAuthGate(options.auth.sessions));

        registerProjectRoutes(gated, {
          projects: options.projects,
          turns,
          terminals,
        });
        registerProfileRoutes(gated, { projects: options.projects, profiles: options.profiles });
        registerCommandRoutes(gated, { projects: options.projects });
        registerSessionRoutes(gated, {
          projects: options.projects,
          provider: options.provider,
          turns,
        });
        registerTerminalSizeRoute(gated, { projects: options.projects, terminals });
        registerFileRoutes(gated, { projects: options.projects });
        registerAuthMeRoute(gated);
      });
    },
    { prefix: '/api' },
  );

  registerWsBus(app, {
    projects: options.projects,
    turns,
    profiles: options.profiles,
    allowBypass: options.allowBypass,
    auth: options.auth,
  });
  // The raw-byte sibling of `/ws`, on the same instance — no second server.
  registerTerminalSocket(app, { projects: options.projects, terminals, auth: options.auth });

  // Last, and on the root scope: the wildcard it registers only answers paths
  // no explicit route already owns, so `/healthz`, `/api/**` and both sockets
  // are served by their own routes (spec-06 §"Ticket 27").
  if (options.webRoot !== null) registerStaticClient(app, options.webRoot);

  return app;
}
