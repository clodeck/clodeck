import type { ProviderProfileSummary, Project } from '@clodeck/shared';

/**
 * The two fixtures every chat-panel test stands on — the project the panel opens
 * and the profile list the server answers it with — plus the one line of browser
 * bookkeeping a stubbed `fetch` needs.
 *
 * They are shared because they are genuinely the same: the chat's suites differ
 * in what they *drive* (the profile a send carries, the session a chat is in),
 * not in what the deployment is, and two copies of a project literal are two
 * things that drift. Same reason `direction.ts` exists, one level down. Not a
 * test file: vitest collects `*.test.*` only.
 */

export const project: Project = { id: 'AAA', name: 'demo', path: '/projects/demo' };

/** A server with one tier of its own beside the reserved default profile. */
export const PROFILES: ProviderProfileSummary[] = [
  { name: 'default', model: 'claude-opus-5-5', shape: 'tier' },
  { name: 'FAST', model: 'claude-haiku-5-5', shape: 'tier' },
];

/** An `ok` JSON response, as `fetch` would hand one back. */
export function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}
