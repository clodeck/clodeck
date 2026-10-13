import { PROTOCOL_VERSION } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { App } from './App';

/**
 * Wiring only, not behaviour — the panels have their own suites beside them
 * (`App.workspace.test.tsx`, `App.projects.test.tsx`, and one per surface).
 * What is worth pinning here is that `web` resolves the shared package through
 * its built entry point, and that the JSX pipeline runs.
 */
describe('web scaffold', () => {
  it('resolves the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('exposes an app component, so the JSX pipeline is wired', () => {
    expect(typeof App).toBe('function');
  });
});
