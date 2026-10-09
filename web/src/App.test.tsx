import { PROTOCOL_VERSION, type Project } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('web scaffold', () => {
  it('resolves the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('type-checks against the shared Project contract', () => {
    const project: Project = { id: 'L3Byb2plY3RzL2Nsb2RlY2s', name: 'clodeck', path: '/projects/clodeck' };

    expect(project.name).toBe('clodeck');
  });

  it('exposes an app component, so the JSX pipeline is wired', () => {
    expect(typeof App).toBe('function');
  });
});
