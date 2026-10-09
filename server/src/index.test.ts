import { PROTOCOL_VERSION } from '@clodeck/shared';
import { describe, expect, it } from 'vitest';

import { SERVER_NAME, describeServer } from './index.js';

describe('server scaffold', () => {
  it('consumes the shared contract package through its built entry point', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  });

  it('identifies itself', () => {
    expect(describeServer()).toBe(`${SERVER_NAME} (protocol v${PROTOCOL_VERSION})`);
  });
});
