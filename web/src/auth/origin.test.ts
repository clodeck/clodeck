import { describe, expect, it } from 'vitest';

import { isCleartextOrigin } from './origin';

/**
 * The rule behind the login screen's notice, at the one boundary rendering
 * cannot reach: the origin is passed in, so every scheme × host combination is
 * a string here rather than a page the suite has to be served from.
 *
 * `LoginScreen.test.tsx` pins the other half — that the screen says what this
 * rule decides.
 */

describe('isCleartextOrigin', () => {
  it('flags a plain-HTTP origin at a host outside the loopback set', () => {
    expect(isCleartextOrigin('http://203.0.113.10:3001')).toBe(true);
    expect(isCleartextOrigin('http://clodeck.example.com')).toBe(true);
    // A LAN address, the deployment that reaches a browser unencrypted.
    expect(isCleartextOrigin('http://192.168.1.20')).toBe(true);
  });

  it('says nothing about https, on any host', () => {
    expect(isCleartextOrigin('https://203.0.113.10:3001')).toBe(false);
    expect(isCleartextOrigin('https://clodeck.example.com')).toBe(false);
    expect(isCleartextOrigin('https://localhost:3001')).toBe(false);
  });

  it('says nothing about loopback, however it is spelled', () => {
    expect(isCleartextOrigin('http://localhost:3001')).toBe(false);
    expect(isCleartextOrigin('http://127.0.0.1:3001')).toBe(false);
    expect(isCleartextOrigin('http://[::1]:3001')).toBe(false);
    // The browser's own case: a host is matched by what it is, not how typed.
    expect(isCleartextOrigin('http://LOCALHOST:3001')).toBe(false);
  });

  it('matches the loopback hosts exactly, not as a name that contains one', () => {
    expect(isCleartextOrigin('http://localhost.example.com')).toBe(true);
    // A tunnelled deployment reaches a browser at loopback, and says so.
    expect(isCleartextOrigin('http://127.0.0.1.example.com')).toBe(true);
  });

  it('has nothing to say about an origin it cannot read', () => {
    expect(isCleartextOrigin('')).toBe(false);
    expect(isCleartextOrigin('not an origin')).toBe(false);
  });
});
