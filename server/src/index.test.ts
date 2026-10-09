import { PROTOCOL_VERSION, type Project } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { SERVER_NAME, describeServer } from './index.js';

describe('server scaffold', () => {
  it('consumes the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('type-checks against the shared Project contract', () => {
    const project: Project = { id: 'L3Byb2plY3RzL2Nsb2RlY2s', name: 'clodeck', path: '/projects/clodeck' };

    expect(project.id).toBeTypeOf('string');
  });

  it('identifies itself', () => {
    expect(describeServer()).toBe(`${SERVER_NAME} (protocol v${PROTOCOL_VERSION})`);
  });
});
