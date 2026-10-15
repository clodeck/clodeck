import type { SDKMessage, SessionMessage, SessionSummary } from '@clodeck/shared';

import { buildApp } from '../app.js';
import { createAuthOptions } from '../auth/options.js';
import { loadConfig } from '../config.js';
import { createProjectDiscovery } from '../discovery.js';
import { createProviderProfiles } from '../profiles.js';
import { createFakeProvider } from './fake-provider.js';
import { createFakePtySpawner } from './fake-pty.js';

/**
 * `npm run dev:fake` — the whole server on the scripted fake.
 *
 * This is how the chat surface is driven by hand with no API key and no
 * network: the same fake the suites use, booted as a real process, so a UI
 * change can be looked at before the SDK is wired to anything real
 * (spec-02 §"Dev without an API key").
 */

const DEFAULT_PORT = 3001;

const SESSION_ID = '00000000-0000-4000-8000-000000000000';

/** One turn: a session opens, text streams, and the turn ends. Replayed per `query()`. */
function transcript(cwd: string): SDKMessage[] {
  return [
    {
      type: 'system',
      subtype: 'init',
      session_id: SESSION_ID,
      cwd,
      model: 'fake-provider',
      permissionMode: 'default',
      tools: ['Read', 'Glob', 'Grep'],
    },
    {
      type: 'stream_event',
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello from the fake provider.' },
      },
    },
    {
      type: 'assistant',
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      message: {
        id: 'msg_fake_1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from the fake provider.' }],
      },
    },
    {
      type: 'result',
      subtype: 'success',
      session_id: SESSION_ID,
      is_error: false,
      result: 'Hello from the fake provider.',
      num_turns: 1,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      duration_ms: 0,
    },
  ];
}

const SESSIONS: SessionSummary[] = [
  { id: SESSION_ID, title: 'A fake session', lastModified: new Date(0).toISOString() },
];

const SESSION_MESSAGES: SessionMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from the fake provider.' }],
  },
];

const config = loadConfig();
const app = buildApp({
  projects: createProjectDiscovery(config.projectsRoot),
  provider: createFakeProvider({
    messages: transcript(config.projectsRoot ?? process.cwd()),
    sessions: SESSIONS,
    sessionMessages: SESSION_MESSAGES,
  }),
  // The real profile list, from this process's own environment: a developer
  // exporting `CLODECK_PROVIDER_FAST_MODEL=…` sees the picker with two entries
  // and drives the choice by hand, which is the whole point of the loop. The
  // fake never reads the trio it is handed.
  profiles: createProviderProfiles(),
  // The scripted fake here too, so `dev:fake` boots with no shell and no native
  // binding — the same "no API key, no network" story as the fake provider.
  spawner: createFakePtySpawner(),
  // The same gate as production: `dev:fake` needs `UI_PASSWORD` too, and
  // without it the loop is fail-closed rather than open (spec-05 §"Further
  // notes"). A dev loop with no login is not a dev loop; it is a rehearsal.
  // The public origin comes along for the same reason it does in `main.ts`.
  auth: await createAuthOptions(config.uiPassword, config.publicOrigin),
  // The same config seam as `main.ts`, resolution and all: a build above the
  // working directory is served from this port too, which the loop never sees —
  // its browser talks to Vite (spec-07 §"The web root").
  webRoot: config.webRoot,
  // The same config seam as `main.ts` here too — the fake stands in for a real
  // provider, not for the deployment around it (ticket 65).
  trustedProxies: config.trustedProxies,
});

// The same loopback default as `main.ts`: the fake must not be reachable from
// the network either. An empty `PORT` counts as unset here too — see `main.ts`.
const port = Number(process.env['PORT']?.trim() || DEFAULT_PORT);
const host = process.env['HOST'] ?? '127.0.0.1';

await app.listen({ port, host });
console.log(`clodeck server (fake provider) listening on http://${host}:${port}`);
