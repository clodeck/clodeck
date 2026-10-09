import { PROTOCOL_VERSION } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('web scaffold', () => {
  it('resolves the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('exposes an app component, so the JSX pipeline is wired', () => {
    expect(typeof App).toBe('function');
  });
});
