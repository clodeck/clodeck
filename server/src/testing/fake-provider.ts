import type {
  ApprovalRequestPayload,
  ApprovalResponsePayload,
  PermissionMode,
  SDKMessage,
  SessionMessage,
  SessionSummary,
  SlashCommand,
} from '@clodeck/shared';

import { BASH_APPROVAL_REASON, bashNeedsApproval } from '../sdk/bash-approval.js';
import type { SdkProvider, SdkRunInput } from '../sdk/provider.js';

/**
 * The scripted fake provider: the second testing seam (spec-02 §Testing).
 *
 * It drives the whole server with no API key and no network, and it is also the
 * *control surface* the later tickets assert through — the bus test reads back
 * the `cwd`/resume/fork/continue a `query()` was called with, and the approval
 * test answers a pending `canUseTool` from outside the run. Test support, not
 * package code: `tsconfig.build.json` keeps `src/testing` out of `dist`.
 */

export interface FakeProviderOptions {
  /** Mirrored messages every `query()` streams, in order. Shared by every run. */
  messages?: readonly SDKMessage[];
  /** Canned `listSessions` result. */
  sessions?: readonly SessionSummary[];
  /** Canned `getSessionMessages` result. */
  sessionMessages?: readonly SessionMessage[];
  /** Canned `supportedCommands()` result: what a started run reports it can dispatch. */
  commands?: readonly SlashCommand[];
  /**
   * Make `supportedCommands()` reject instead of answering — a run whose list
   * cannot be read, which must leave the client with what it already had rather
   * than take the turn down.
   */
  commandsFail?: boolean;
  /**
   * Park every run's stream open after the scripted queue instead of returning.
   * A scripted turn otherwise drains inside a microtask — long before a second
   * frame is read — so the bus's busy paths (`turn_in_progress`, `interrupt`)
   * are only reachable deterministically against a run a test holds open.
   */
  holdRuns?: boolean;
  /**
   * Throw after the scripted queue instead of returning — a run that failed
   * mid-turn, for the bus's error path. Takes precedence over `holdRuns`.
   */
  failRuns?: boolean;
}

/**
 * The fake's control surface, on top of the interface the server sees. Every
 * `waitFor*` resolves immediately when the call has already happened, so a test
 * never has to know whether the server got there first.
 */
export interface FakeProvider extends SdkProvider {
  /** Every `query()` input, in call order. */
  readonly queryInputs: readonly SdkRunInput[];
  /** The n-th `query()` input (1-based), parking until the server makes it. */
  waitForQueryInput(count: number): Promise<SdkRunInput>;
  /** Every `setPermissionMode()` argument, in call order. */
  readonly permissionModes: readonly PermissionMode[];
  waitForPermissionMode(count: number): Promise<PermissionMode>;
  readonly interruptCount: number;
  waitForInterrupt(count: number): Promise<void>;
  /**
   * Invoke the `canUseTool` the latest `query()` was handed and hand back its
   * promise — the SDK's side of an approval, so a test can answer it through
   * the bus and watch the run's promise settle.
   */
  requestApproval(request: ApprovalRequestPayload): Promise<ApprovalResponsePayload>;
  /**
   * The ticket-83 gate, driven from outside the run: a Bash call in Ask or
   * Accept edits goes through `canUseTool` exactly as the real run's
   * `PreToolUse` hook sends it. Every other tool is settled here as unprompted,
   * which is what Accept edits does for the file tools — a gate the test itself
   * wants to raise uses `requestApproval` instead.
   *
   * `asked` says which happened, so a test can tell "the user allowed it" from
   * "the gate never opened".
   */
  requestToolUse(toolName: string, input: Record<string, unknown>): Promise<ToolRun>;
  /** Let every held run finish. A no-op when `holdRuns` was not set. */
  releaseRuns(): void;
  /** Every `deleteSession()` call, in order. */
  readonly deletedSessions: readonly DeletedSession[];
}

/** One `deleteSession()` argument pair, as the provider received it. */
export interface DeletedSession {
  sessionId: string;
  dir: string;
}

/** What a driven tool call settled on, and whether the run's gate had to ask. */
export interface ToolRun {
  /** True when the call went through `canUseTool`; false when it ran unprompted. */
  readonly asked: boolean;
  /** The gate's answer. `allow` means the tool runs. */
  readonly result: ApprovalResponsePayload;
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const scripted = options.messages ?? [];
  // The canned list is the fake's disk: a delete takes the row out of it, so a
  // later `listSessions()` — a History refresh — no longer sees what was deleted.
  const sessions = [...(options.sessions ?? [])];
  const sessionMessages = options.sessionMessages ?? [];
  const commands = options.commands ?? [];
  const inputs = createCallLog<SdkRunInput>();
  const modes = createCallLog<PermissionMode>();
  const interrupts = createCallLog<void>();
  // A plain log, not a `createCallLog`: the route answers only after the delete
  // returns, so a test that has its response has its record too — there is no
  // race for a waiter to close.
  const deletions: DeletedSession[] = [];
  const hold = createGate();
  // Ids for the calls `requestToolUse` drives: the test reads the request's own
  // id off the wire, so these only have to be unique within the process.
  let toolSeq = 0;

  return {
    query(input) {
      inputs.record(input);

      return {
        messages: streamMessages(scripted, endingFor(options, hold)),
        async supportedCommands() {
          if (options.commandsFail === true) throw new Error('scripted command-list failure');
          return [...commands];
        },
        async interrupt() {
          interrupts.record(undefined);
        },
        async setPermissionMode(mode) {
          modes.record(mode);
        },
      };
    },

    async listSessions() {
      return [...sessions];
    },

    async getSessionMessages() {
      return [...sessionMessages];
    },

    async deleteSession(sessionId, dir) {
      deletions.push({ sessionId, dir });
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index !== -1) sessions.splice(index, 1);
    },

    get queryInputs() {
      return inputs.all();
    },
    waitForQueryInput(count) {
      return inputs.waitFor(count);
    },

    get permissionModes() {
      return modes.all();
    },
    waitForPermissionMode(count) {
      return modes.waitFor(count);
    },

    get interruptCount() {
      return interrupts.all().length;
    },
    waitForInterrupt(count) {
      return interrupts.waitFor(count);
    },

    requestApproval(request) {
      const latest = inputs.all()[inputs.all().length - 1];
      const callback = latest?.canUseTool;
      if (callback === undefined) {
        return Promise.reject(
          new Error('the fake provider has no canUseTool to drive — pass one to query()'),
        );
      }
      return callback(request);
    },

    async requestToolUse(toolName, input) {
      const latest = inputs.all()[inputs.all().length - 1];
      if (latest === undefined) {
        throw new Error('the fake provider has no run to drive — call query() first');
      }

      const mode = latest.permissionMode ?? 'default';
      if (toolName !== 'Bash' || !bashNeedsApproval(mode)) {
        toolSeq += 1;
        return {
          asked: false,
          result: { requestId: `fake-tool-${toolSeq}`, behavior: 'allow' },
        };
      }

      const callback = latest.canUseTool;
      if (callback === undefined) {
        throw new Error('the fake provider has no canUseTool to drive — pass one to query()');
      }

      toolSeq += 1;
      const id = toolSeq;
      const result = await callback({
        requestId: `fake-tool-${id}`,
        toolUseID: `fake-tool-use-${id}`,
        toolName,
        input,
        decisionReason: BASH_APPROVAL_REASON,
      });
      return { asked: true, result };
    },

    releaseRuns() {
      hold.open();
    },

    get deletedSessions() {
      return deletions;
    },
  };
}

/**
 * Yields the scripted queue as a fresh generator per run, so every run replays
 * it. How it *ends* after the queue is the test's choice: normally it returns,
 * a held run waits for `releaseRuns()`, and a failing run throws.
 */
async function* streamMessages(
  queue: readonly SDKMessage[],
  ending: Ending,
): AsyncIterable<SDKMessage> {
  for (const message of queue) {
    yield message;
  }
  if (ending.kind === 'fail') {
    throw new Error('scripted failure');
  }
  if (ending.kind === 'hold') {
    await ending.gate.wait();
  }
}

type Ending = { kind: 'complete' } | { kind: 'hold'; gate: Gate } | { kind: 'fail' };

function endingFor(options: FakeProviderOptions, gate: Gate): Ending {
  if (options.failRuns === true) return { kind: 'fail' };
  if (options.holdRuns === true) return { kind: 'hold', gate };
  return { kind: 'complete' };
}

/** A one-shot latch: closed until `open()`, after which every waiter and every later `wait()` proceeds. */
interface Gate {
  wait(): Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let opened = false;
  const waiters: (() => void)[] = [];

  return {
    wait() {
      if (opened) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    open() {
      opened = true;
      for (const resolve of waiters.splice(0)) resolve();
    },
  };
}

interface CallLog<T> {
  record(value: T): void;
  /** The n-th call (1-based): already resolved, now or later. */
  waitFor(count: number): Promise<T>;
  all(): readonly T[];
}

/**
 * An append-only call log with waiters. The server reaches a call asynchronously,
 * so a test asserting "the bus interrupted the run" has to be able to park until
 * it actually did — a snapshot array alone would make every such test a race.
 */
function createCallLog<T>(): CallLog<T> {
  const calls: T[] = [];
  const waiters: { count: number; resolve: (value: T) => void }[] = [];

  return {
    record(value) {
      calls.push(value);
      for (let index = 0; index < waiters.length; ) {
        const waiter = waiters[index];
        if (waiter !== undefined && calls.length >= waiter.count) {
          waiters.splice(index, 1);
          waiter.resolve(calls[waiter.count - 1] as T);
        } else {
          index += 1;
        }
      }
    },

    waitFor(count) {
      if (count <= calls.length) {
        return Promise.resolve(calls[count - 1] as T);
      }
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },

    all() {
      return calls;
    },
  };
}
