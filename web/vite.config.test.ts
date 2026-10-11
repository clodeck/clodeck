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

/** The proxy's `/api` target and whether `/ws` rides the same origin, as Vite would load it. */
async function proxy(port: string | undefined): Promise<{ target: string; ws: boolean }> {
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

  return { target: api.target, ws: configured?.['/ws']?.ws === true };
}

describe('the dev proxy', () => {
  it('targets the default backend port when PORT is unset', async () => {
    await expect(proxy(undefined)).resolves.toEqual({ target: 'http://127.0.0.1:3001', ws: true });
  });

  it('treats an empty PORT as unset, rather than proxying to nothing', async () => {
    await expect(proxy('')).resolves.toEqual({ target: 'http://127.0.0.1:3001', ws: true });
  });

  it('follows PORT, so one variable moves the server and the proxy together', async () => {
    await expect(proxy('3300')).resolves.toEqual({ target: 'http://127.0.0.1:3300', ws: true });
  });
});
