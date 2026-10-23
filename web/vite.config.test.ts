import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The dev proxy's target and the backend's port have to move together. When they
 * drift, every request through the client is a 502 from the proxy while the
 * server's own log says nothing at all — which is exactly what a hard-coded 3001
 * produced when Windows handed 3001 to a Hyper-V port exclusion, so the proxy's
 * target is pinned here rather than left to the next person's memory.
 */

const ORIGINAL = process.env['PORT'];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['PORT'];
  else process.env['PORT'] = ORIGINAL;
  vi.resetModules();
});

/**
 * The proxy's `/api` target, whether `/ws` rides the same origin, and where
 * `/healthz` goes, as Vite would load it. The health check is the login
 * screen's build stamp before any session exists (ticket 94), so it is pinned
 * with the other two rather than left to be re-discovered.
 */
async function proxy(
  port: string | undefined,
): Promise<{ target: string; ws: boolean; health: string }> {
  // The config reads `PORT` at module load, so the module is re-imported per case.
  vi.resetModules();
  if (port === undefined) delete process.env['PORT'];
  else process.env['PORT'] = port;

  const { default: config } = await import('./vite.config');
  const configured = config.server?.proxy as unknown as
    | Record<string, { target: string; ws?: boolean }>
    | undefined;
  const api = configured?.['/api'];
  if (api === undefined) throw new Error('the config proxies no /api');
  const health = configured?.['/healthz'];
  if (health === undefined) throw new Error('the config proxies no /healthz');

  return { target: api.target, ws: configured?.['/ws']?.ws === true, health: health.target };
}

describe('the dev proxy', () => {
  it('targets the default backend port when PORT is unset', async () => {
    await expect(proxy(undefined)).resolves.toEqual({
      target: 'http://127.0.0.1:3001',
      ws: true,
      health: 'http://127.0.0.1:3001',
    });
  });

  it('treats an empty PORT as unset, rather than proxying to nothing', async () => {
    await expect(proxy('')).resolves.toEqual({
      target: 'http://127.0.0.1:3001',
      ws: true,
      health: 'http://127.0.0.1:3001',
    });
  });

  it('follows PORT, so one variable moves the server and the proxy together', async () => {
    await expect(proxy('3300')).resolves.toEqual({
      target: 'http://127.0.0.1:3300',
      ws: true,
      health: 'http://127.0.0.1:3300',
    });
  });
});
