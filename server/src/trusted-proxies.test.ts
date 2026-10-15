import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { trustedProxyList } from './trusted-proxies.js';

/**
 * The declared trust list, and the one promise that keeps it from being a boot
 * failure: a value the app cannot compile is a warning and "trust nothing",
 * never a server that will not start (ticket 65).
 */
describe('the declared trust list', () => {
  /** What the operator would have heard, and the list Fastify would be given. */
  function read(declared: string | null): { list: string | null; warnings: string[] } {
    const warnings: string[] = [];
    return { list: trustedProxyList(declared, (message) => warnings.push(message)), warnings };
  }

  it('reads an undeclared list as nothing trusted, in silence', () => {
    expect(read(null)).toEqual({ list: null, warnings: [] });
  });

  it('passes addresses, ranges and keywords through, alone or in a list', () => {
    const declared = [
      'loopback',
      'uniquelocal',
      '203.0.113.7',
      '172.16.0.0/12',
      '127.0.0.1/8,172.16.0.0/12',
      'loopback,linklocal,uniquelocal',
    ];

    for (const value of declared) {
      expect(read(value), value).toEqual({ list: value, warnings: [] });
    }
  });

  it('ignores the whitespace a list gets typed with', () => {
    // A space after each comma is what a hand-written compose file looks like,
    // and it is the same list: the entries are handed on trimmed.
    expect(read(' loopback , 172.16.0.0/12 ').list).toBe('loopback,172.16.0.0/12');
  });

  it('reports a list it cannot compile, and trusts nothing instead', () => {
    const malformed = ['caddy', '172.16.0.0/33', '127.0.0.1/8,', 'loopback,,10.0.0.0/8'];

    for (const declared of malformed) {
      const { list, warnings } = read(declared);
      expect(list, declared).toBeNull();
      // The line speaks the operator's vocabulary: the variable they set, what
      // they set it to, and what it costs them.
      expect(warnings.join('\n'), declared).toContain('CLODECK_TRUSTED_PROXIES');
      expect(warnings.join('\n'), declared).toContain(declared);
    }
  });

  it('never hands Fastify a value it would refuse to boot with', () => {
    // The reason this module compiles the list at all: Fastify compiles
    // `trustProxy` in its constructor and throws on a value it cannot read, so
    // whatever survives here — and the `undefined` a rejected list becomes — has
    // to be a value a server can be built around.
    for (const declared of ['loopback', '172.16.0.0/12', 'caddy', '172.16.0.0/33', '127.0.0.1/8,']) {
      const trustProxy = trustedProxyList(declared, () => undefined) ?? undefined;
      expect(() => Fastify({ logger: false, trustProxy }), declared).not.toThrow();
    }
  });
});
