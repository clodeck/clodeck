import { describe, expect, it, vi } from 'vitest';

import { createFakePtySpawner } from '../testing/fake-pty.js';
import { createTerminalManager } from './manager.js';

/**
 * The terminal manager's behavior, driven entirely through the fake spawner:
 * one shell per project, and the full lifecycle the transport will lean on next
 * ticket. No test here forks a real shell.
 */

const A = { cwd: '/projects/a', cols: 80, rows: 24 };
const B = { cwd: '/projects/b', cols: 100, rows: 30 };

describe('the terminal manager', () => {
  it('spawns a shell in the project’s directory at the requested size', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);

    manager.open('a', { ...A, onData: () => {} });

    expect(spawner.spawns).toEqual([{ cwd: '/projects/a', cols: 80, rows: 24 }]);
    expect(manager.has('a')).toBe(true);
  });

  it('routes the shell’s output to the callback the open was given', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    const received: string[] = [];

    manager.open('a', { ...A, onData: (data) => received.push(data) });
    spawner.handle(1).emitData('hello from the shell');

    expect(received).toEqual(['hello from the shell']);
  });

  it('writes raw bytes to the project’s shell, and reports a project with none', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    manager.open('a', { ...A, onData: () => {} });

    expect(manager.write('a', 'ls\r')).toBe(true);
    expect(spawner.handle(1).written).toEqual(['ls\r']);

    expect(manager.write('b', 'nope')).toBe(false);
  });

  it('resizes the project’s shell by id, and reports a project with none', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    manager.open('a', { ...A, onData: () => {} });

    expect(manager.resize('a', { cols: 120, rows: 40 })).toBe(true);
    expect(spawner.handle(1).resizes).toEqual([{ cols: 120, rows: 40 }]);

    expect(manager.resize('b', { cols: 1, rows: 1 })).toBe(false);
  });

  it('pauses and resumes the project’s shell, for flow control', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    manager.open('a', { ...A, onData: () => {} });

    expect(manager.pause('a')).toBe(true);
    expect(manager.resume('a')).toBe(true);

    expect(spawner.handle(1).pauseCount).toBe(1);
    expect(spawner.handle(1).resumeCount).toBe(1);
    expect(manager.pause('b')).toBe(false);
    expect(manager.resume('b')).toBe(false);
  });

  it('kills the shell on close and forgets it', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    manager.open('a', { ...A, onData: () => {} });

    expect(manager.close('a')).toBe(true);

    expect(spawner.handle(1).killCount).toBe(1);
    expect(manager.has('a')).toBe(false);
    expect(manager.close('a')).toBe(false);
  });

  it('reaps the entry when the shell exits, and tells the listener', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    const exited: string[] = [];
    manager.onExit((projectId) => exited.push(projectId));
    manager.open('a', { ...A, onData: () => {} });
    manager.open('b', { ...B, onData: () => {} });

    spawner.handle(1).exit(0);

    expect(manager.has('a')).toBe(false);
    expect(manager.has('b')).toBe(true);
    expect(exited).toEqual(['a']);
  });

  it('stops notifying a listener that unsubscribed', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    const listener = vi.fn();
    const unsubscribe = manager.onExit(listener);
    manager.open('a', { ...A, onData: () => {} });

    unsubscribe();
    spawner.handle(1).exit(0);

    expect(listener).not.toHaveBeenCalled();
  });

  it('replaces an existing shell with a fresh one when a project opens again', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    const exited: string[] = [];
    manager.onExit((projectId) => exited.push(projectId));

    manager.open('a', { ...A, onData: () => {} });
    manager.open('a', { ...A, cols: 200, rows: 50, onData: () => {} });

    // The first shell is killed, and the live entry is the second handle.
    expect(spawner.handle(1).killCount).toBe(1);
    expect(spawner.spawns).toHaveLength(2);
    expect(manager.write('a', 'x')).toBe(true);
    expect(spawner.handle(2).written).toEqual(['x']);

    // The replaced handle exiting later must not reap the replacement.
    spawner.handle(1).exit(0);
    expect(manager.has('a')).toBe(true);
    expect(exited).toEqual([]);
  });

  it('kills every shell on dispose', () => {
    const spawner = createFakePtySpawner();
    const manager = createTerminalManager(spawner);
    manager.open('a', { ...A, onData: () => {} });
    manager.open('b', { ...B, onData: () => {} });

    manager.dispose();

    expect(spawner.handle(1).killCount).toBe(1);
    expect(spawner.handle(2).killCount).toBe(1);
    expect(manager.has('a')).toBe(false);
    expect(manager.has('b')).toBe(false);
  });
});
