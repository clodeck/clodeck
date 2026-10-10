import { describe, expect, it } from 'vitest';

import { createFakePtySpawner } from './fake-pty.js';

/**
 * The fake spawner is the seam every later terminal test drives the server
 * through, so its *control surface* is the thing under test here: what it
 * records, and whether a test can park until a spawn it has not made yet. Its
 * `spawn()`-shaped behavior is covered where it is consumed (the manager, and
 * ticket 13's transport).
 */

describe('the scripted fake pty spawner', () => {
  it('records every spawn and hands out a distinct handle for each', () => {
    const spawner = createFakePtySpawner();

    spawner.spawn({ cwd: '/projects/a', cols: 80, rows: 24 });
    spawner.spawn({ cwd: '/projects/b', cols: 100, rows: 30 });

    expect(spawner.spawns).toEqual([
      { cwd: '/projects/a', cols: 80, rows: 24 },
      { cwd: '/projects/b', cols: 100, rows: 30 },
    ]);
    expect(spawner.handle(1)).not.toBe(spawner.handle(2));
  });

  it('throws when asked for a handle it never handed out', () => {
    const spawner = createFakePtySpawner();

    expect(() => spawner.handle(1)).toThrow(/never spawned|no pty/);
  });

  it('parks a waiter until a spawn the test has not made yet arrives', async () => {
    const spawner = createFakePtySpawner();

    const pending = spawner.waitForSpawn(1);
    spawner.spawn({ cwd: '/projects/a', cols: 80, rows: 24 });

    await expect(pending).resolves.toEqual({ cwd: '/projects/a', cols: 80, rows: 24 });
  });

  it('resolves a waiter immediately when the spawn already happened', async () => {
    const spawner = createFakePtySpawner();
    spawner.spawn({ cwd: '/projects/a', cols: 80, rows: 24 });

    await expect(spawner.waitForSpawn(1)).resolves.toEqual({ cwd: '/projects/a', cols: 80, rows: 24 });
  });
});
