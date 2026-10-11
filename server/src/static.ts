import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * The built web client, served by the server (spec-06 §"Ticket 27").
 *
 * Before this, the client only ever existed behind Vite: `npm run build &&
 * npm start` produced an API with no UI. Serving `web/dist` here is what makes
 * the app one deployable artifact — and the reason the auth story's "the
 * bundle is public, the data is gated" becomes observable: this is registered
 * on the *root* scope, so the static route carries no gate, while `/api/**`,
 * `/ws` and `/ws/terminal` keep theirs. Public files, gated data.
 *
 * The plugin's wildcard route only ever answers with a file that exists; a
 * missing one goes to `callNotFound()`, which is where the SPA fallback below
 * picks it up.
 */
export function registerStaticClient(app: FastifyInstance, webRoot: string): void {
  app.register(fastifyStatic, { root: webRoot });

  /**
   * The client owns its own routes (`/projects/:id/…`), so a URL the browser
   * asks for that no *file* backs is a deep link or a refresh, not a missing
   * resource — it gets the app shell, and the client routes from there.
   *
   * Only a request that asks for html gets that. A `fetch` accepts anything,
   * so a genuinely missing path still answers 404 rather than handing an API
   * client a page it cannot use.
   */
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && wantsHtml(request.headers.accept)) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({ error: 'not found' });
  });
}

/**
 * Whether a request's `Accept` asks for html. A substring test, not a full
 * negotiation: the only caller is a browser asking for a page, and its header
 * is `text/html,application/xhtml+xml,…` when it does.
 */
function wantsHtml(accept: string | undefined): boolean {
  return accept !== undefined && accept.includes('text/html');
}
