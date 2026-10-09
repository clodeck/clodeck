import { PROTOCOL_VERSION } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { App } from './App';

/**
 * Wiring only, not behaviour: this slice has no web component tests (the spec
 * puts them out of scope; the chat slice brings the seam). What is worth
 * pinning here is that `web` resolves the shared package through its built
 * entry point, and that the JSX pipeline runs.
 */
describe('web scaffold', () => {
  it('resolves the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('exposes an app component, so the JSX pipeline is wired', () => {
    expect(typeof App).toBe('function');
  });
});
