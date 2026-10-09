import { PROTOCOL_VERSION } from '@clodeck/shared';

/**
 * The server package, as a library.
 *
 * This is the scaffold seam the slice hangs off: ticket 03 adds the Fastify
 * instance and its routes here (`GET /healthz`, `GET /api/projects`) without
 * changing how the package is entered or built.
 */
export const SERVER_NAME = 'clodeck-server';

/** Identity line for logs and smoke checks. */
export function describeServer(): string {
  return `${SERVER_NAME} (protocol v${PROTOCOL_VERSION})`;
}
