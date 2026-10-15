// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { browserStorage, readRememberedProfile, rememberProfile } from './providerMemory';

/**
 * What the browser remembers about a project, and what it does when it cannot
 * remember anything: the state behind ticket 68's eighth criterion — a new
 * session opens on the profile the last one used, and on the reserved default
 * when there is nothing to open on.
 *
 * The store is a parameter, so the two interesting cases are both fakeable: a
 * store with entries in it, and a store that refuses to be read or written (a
 * privacy mode). The browser's own is exercised through `browserStorage`.
 */

function fakeStorage(entries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(entries));
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

/** A store that throws on every access, the way one behind a privacy mode does. */
function refusingStorage(): Storage {
  return {
    ...fakeStorage(),
    getItem: () => {
      throw new Error('storage is disabled');
    },
    setItem: () => {
      throw new Error('storage is disabled');
    },
  };
}

describe('the remembered profile', () => {
  it('is nothing at all for a project that has never chosen one', () => {
    expect(readRememberedProfile(fakeStorage(), 'AAA')).toBeNull();
  });

  it('is per project, and the last choice for a project wins', () => {
    const storage = fakeStorage();

    rememberProfile(storage, 'AAA', 'FAST');
    rememberProfile(storage, 'BBB', 'STRONG');
    rememberProfile(storage, 'AAA', 'STRONG');

    expect(readRememberedProfile(storage, 'AAA')).toBe('STRONG');
    expect(readRememberedProfile(storage, 'BBB')).toBe('STRONG');
    // A project that never chose is untouched by its neighbours — the whole
    // point of keying by project rather than holding one value.
    expect(readRememberedProfile(storage, 'CCC')).toBeNull();
  });

  it('reads back a name the server no longer offers, rather than quietly defaulting', () => {
    const storage = fakeStorage({ 'clodeck.provider.AAA': 'GONE' });

    // What is remembered is what is remembered: a stale name is the server's to
    // refuse, visibly, and the client inventing a fallback would hide it.
    expect(readRememberedProfile(storage, 'AAA')).toBe('GONE');
  });

  it('counts an empty entry as nothing remembered', () => {
    expect(readRememberedProfile(fakeStorage({ 'clodeck.provider.AAA': '' }), 'AAA')).toBeNull();
  });

  it('answers nothing, and throws nothing, where a browser refuses a store at all', () => {
    expect(readRememberedProfile(null, 'AAA')).toBeNull();
    expect(() => {
      rememberProfile(null, 'AAA', 'FAST');
    }).not.toThrow();

    const refusing = refusingStorage();
    expect(readRememberedProfile(refusing, 'AAA')).toBeNull();
    // A remember that cannot be written is a convenience lost, not a failure.
    expect(() => {
      rememberProfile(refusing, 'AAA', 'FAST');
    }).not.toThrow();
  });

  it('reaches the browser’s own store through browserStorage', () => {
    const storage = browserStorage();

    expect(storage).not.toBeNull();
    if (storage === null) return;
    rememberProfile(storage, 'AAA', 'FAST');
    expect(readRememberedProfile(storage, 'AAA')).toBe('FAST');
    storage.clear();
  });
});
