import { describe, expect, it } from 'vitest';

import { cleartextOriginWarning } from './public-origin.js';

/**
 * Which declared origins a running server speaks up about (spec-07 §"The
 * warnings"). The predicate is pure, so it is tested where it is decided rather
 * than by booting a server and reading its stderr.
 */
describe('the plain-HTTP origin warning', () => {
  it('names the variable and the cleartext cost on a non-loopback http: origin', () => {
    const warning = cleartextOriginWarning('http://203.0.113.10:3001');

    expect(warning).toContain('CLODECK_PUBLIC_URL');
    expect(warning).toContain('http://203.0.113.10:3001');
    expect(warning).toContain('cleartext');
    // "One unmissable line", not a paragraph.
    expect(warning).not.toContain('\n');
  });

  it('says nothing about a loopback http: origin', () => {
    for (const origin of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
      expect(cleartextOriginWarning(origin)).toBeNull();
    }
  });

  it('says nothing about an https: origin', () => {
    expect(cleartextOriginWarning('https://clodeck.example.com')).toBeNull();
  });

  it('says nothing when no origin is declared', () => {
    expect(cleartextOriginWarning(null)).toBeNull();
  });

  it('says nothing about a value that is not an origin at all', () => {
    // The auth transport is where that one is reported: it is the one that has
    // to decide a cookie, and it keeps the cookie `Secure` while it complains.
    expect(cleartextOriginWarning('203.0.113.10:3001')).toBeNull();
  });
});
