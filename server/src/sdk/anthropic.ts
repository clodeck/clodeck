import {
  getSessionMessages as sdkGetSessionMessages,
  listSessions as sdkListSessions,
  query as sdkQuery,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SessionMessage as SdkSessionMessage,
  type SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';

import type {
  ApprovalResponsePayload,
  ContentBlock,
  ResolvedProvider,
  SDKMessage,
  SessionMessage,
  SessionSummary,
  SlashCommand,
} from '@clodeck/shared';

import { narrowToMirror } from './mirror.js';
import type { ApprovalCallback, SdkProvider, SdkRun, SdkRunInput } from './provider.js';

/**
 * The real provider: the only module that imports the Agent SDK at runtime.
 *
 * Everything crossing back out of here is a shared type — the mirrored message
 * stream, the two history shapes, the approval payloads — so the SDK can be
 * swapped and no consumer changes. A credential crosses *in*, on a run's
 * `provider`, and `providerEnv` is the only way `Options.env` is ever set: the
 * server reads what the operator exported into its own environment, and never
 * invents, stores or persists one
 * (`docs/adr/0002-provider-credentials-travel-with-their-endpoint.md`).
 */

/**
 * A transcript entry that is a turn. The SDK's own `SessionMessage` also carries
 * `system` rows (compact boundaries, notices); those are not turns, so they are
 * excluded before normalizing rather than mislabelled here.
 */
export type TranscriptTurn = Omit<SdkSessionMessage, 'type'> & { type: 'user' | 'assistant' };

/**
 * The boot-time instance is the reserved **default** profile: it starts every
 * run with no provider of its own, so each one runs on the server's own
 * environment. A run that carries a provider travels through `providerEnv`
 * instead, and an operator who has declared no profile sees no change at all.
 */
export function createAnthropicProvider(): SdkProvider {
  return {
    query(input) {
      return startRun(input);
    },

    async listSessions(dir) {
      // The SDK already orders by `lastModified` descending; re-sorting here
      // would only be a chance to disagree with it.
      return (await sdkListSessions({ dir })).map(normalizeSessionInfo);
    },

    async getSessionMessages(sessionId, dir) {
      // `includeSystemMessages` defaults to false; stating it keeps compact
      // boundaries and notices out of the transcript even if that default moves.
      const entries = await sdkGetSessionMessages(sessionId, { dir, includeSystemMessages: false });
      return entries.filter(isTranscriptTurn).map(normalizeSessionMessage);
    },
  };
}

function startRun(input: SdkRunInput): SdkRun {
  const abortController = new AbortController();
  forwardAbort(input.signal, abortController);

  const query = sdkQuery({ prompt: input.prompt, options: toSdkOptions(input, abortController) });

  return {
    messages: mirrorMessages(query),
    // Annotated so the SDK's own row is checked against the mirror's wider one:
    // a field the client reads and the SDK renames would fail the build here.
    supportedCommands: async (): Promise<SlashCommand[]> => await query.supportedCommands(),
    async interrupt() {
      await query.interrupt();
    },
    setPermissionMode: (mode) => query.setPermissionMode(mode),
  };
}

function toSdkOptions(input: SdkRunInput, abortController: AbortController): Options {
  const options: Options = {
    cwd: input.cwd,
    // Deltas for a live bubble; the complete `assistant` message still follows.
    includePartialMessages: true,
    // Read-only tools never prompt; anything else asks through `canUseTool`.
    allowedTools: ['Read', 'Glob', 'Grep'],
    settingSources: ['project'],
    permissionMode: input.permissionMode ?? 'default',
    abortController,
  };

  // Absent a provider, `env` stays unset and the subprocess inherits the
  // environment this process was started with — the default profile.
  const env = providerEnv(input.provider);
  if (env !== null) options.env = env;

  if (input.resume !== undefined) options.resume = input.resume;
  if (input.forkSession !== undefined) options.forkSession = input.forkSession;
  if (input.continueLatest === true) options.continue = true;
  if (input.canUseTool !== undefined) options.canUseTool = toSdkCanUseTool(input.canUseTool);

  return options;
}

/**
 * The environment one run's subprocess gets: `null` when the run carries no
 * provider, so no `env` is set and the subprocess inherits `process.env`.
 *
 * `Options.env` **replaces** the subprocess environment rather than merging into
 * it — the SDK says so where it declares the field — so the ambient variables
 * are spread in first and the provider's keys are laid over them. Set without
 * that spread, a provider would take `PATH`, `HOME` and every other inherited
 * variable down with it. The spread lives *here* so that no caller can set
 * `Options.env` without it.
 *
 * Exported, and a function of `process.env` alone, so this — the one place a
 * credential enters the SDK — is tested directly rather than verified by
 * reading.
 */
export function providerEnv(
  provider: ResolvedProvider | undefined,
): Record<string, string | undefined> | null {
  if (provider === undefined) return null;

  const env: Record<string, string | undefined> = { ...process.env };

  // Only the keys the provider carries: one set to `undefined` would blank an
  // ambient value instead of leaving it standing.
  if (provider.baseUrl !== undefined) env['ANTHROPIC_BASE_URL'] = provider.baseUrl;
  if (provider.authToken !== undefined) env['ANTHROPIC_AUTH_TOKEN'] = provider.authToken;
  if (provider.model !== undefined) env['ANTHROPIC_MODEL'] = provider.model;

  return env;
}

/**
 * The caller's `AbortSignal` is theirs and the SDK wants an `AbortController`,
 * so this is where one becomes the other.
 */
function forwardAbort(signal: AbortSignal | undefined, abortController: AbortController): void {
  if (signal === undefined) return;
  if (signal.aborted) {
    abortController.abort();
    return;
  }
  signal.addEventListener('abort', () => abortController.abort(), { once: true });
}

/**
 * The pin again, at runtime: the SDK's own union is wider than the mirror, so
 * each message is narrowed and the families the client neither renders nor acts
 * on — task events, rate limits, hook lifecycle — never reach the wire.
 */
async function* mirrorMessages(query: Query): AsyncIterable<SDKMessage> {
  for await (const message of query) {
    const mirrored = narrowToMirror(message);
    if (mirrored !== null) {
      yield mirrored;
    }
  }
}

/**
 * The SDK's session-list row as the picker's. `fileSize`, `cwd` and `gitBranch`
 * are dropped: the UI does not use them yet, and adding one later is a
 * normalization change rather than a model change.
 */
export function normalizeSessionInfo(info: SDKSessionInfo): SessionSummary {
  const summary: SessionSummary = {
    id: info.sessionId,
    // `summary` is required but can be empty, which is what keeps `firstPrompt`
    // reachable; an empty value counts as absent at every step.
    title: info.customTitle || info.summary || info.firstPrompt || 'Untitled',
    lastModified: toIso8601(info.lastModified),
  };

  const createdAt = toIso8601(info.createdAt);
  if (createdAt !== undefined) summary.createdAt = createdAt;
  if (info.tag !== undefined) summary.tag = info.tag;

  return summary;
}

/**
 * The SDK reports epoch milliseconds; the wire uses ISO 8601 throughout, and a
 * non-finite value would only ever render as `Invalid Date`.
 */
function toIso8601(epochMillis: number | undefined): string | undefined {
  return epochMillis === undefined || !Number.isFinite(epochMillis)
    ? undefined
    : new Date(epochMillis).toISOString();
}

/** `SessionMessage.type` narrows the SDK's three-member union to the two that are turns. */
function isTranscriptTurn(message: SdkSessionMessage): message is TranscriptTurn {
  return message.type !== 'system';
}

/** One persisted transcript entry as the shared shape, complete blocks only. */
export function normalizeSessionMessage(message: TranscriptTurn): SessionMessage {
  const content = toContentBlocks(message.message);
  const normalized: SessionMessage = { role: message.type, content };

  // Optional keys are added only when they exist, so "no subagent frame" reaches
  // the client as an absent field rather than a null it has to filter.
  const toolUseId = firstToolUseId(content);
  if (toolUseId !== undefined) normalized.toolUseId = toolUseId;
  if (message.parent_tool_use_id !== null) normalized.parentToolUseId = message.parent_tool_use_id;

  return normalized;
}

/**
 * `SessionMessage.message` is `unknown` — the SDK hands back persisted JSON, not
 * a typed shape. A plain string is the user's prompt in its other encoding, and
 * wraps into a text block so history renders through the same block renderer as
 * the live stream; anything that is not a block is dropped, not forwarded.
 */
function toContentBlocks(message: unknown): readonly ContentBlock[] {
  const content =
    typeof message === 'object' && message !== null
      ? (message as { content?: unknown }).content
      : undefined;

  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(isContentBlock);
}

/** A persisted block is anything carrying a `type`; the mirror's `UnknownContentBlock` takes the rest. */
function isContentBlock(value: unknown): value is ContentBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * The tool call an entry is about: an assistant entry names its own `tool_use`,
 * a user entry names the `tool_use_id` its `tool_result` answers. Either is what
 * lets a transcript's tool card and its result find each other.
 */
function firstToolUseId(content: readonly ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type === 'tool_use' && 'id' in block) return block.id;
    if (block.type === 'tool_result' && 'tool_use_id' in block) return block.tool_use_id;
  }
  return undefined;
}

/**
 * The one place the SDK's `CanUseTool` and the shared `ApprovalCallback` meet.
 * Exported so this bridge — the riskiest shape in the file, and the one the fake
 * cannot stand in for — is testable without the network.
 */
export function toSdkCanUseTool(callback: ApprovalCallback): CanUseTool {
  return async (toolName, input, options) => {
    const response = await callback({
      requestId: options.requestId,
      toolUseID: options.toolUseID,
      toolName,
      input,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
      suggestions: options.suggestions,
      defaultToNo: options.defaultToNo,
    });

    return toPermissionResult(response);
  };
}

function toPermissionResult(response: ApprovalResponsePayload): PermissionResult {
  if (response.behavior === 'allow') {
    return {
      behavior: 'allow',
      ...(response.updatedInput !== undefined ? { updatedInput: response.updatedInput } : {}),
      // These are the request's own `suggestions` echoed back unread, so the
      // payload's widened `unknown[]` narrows back to the SDK's own type here.
      ...(response.updatedPermissions !== undefined
        ? { updatedPermissions: response.updatedPermissions as PermissionUpdate[] }
        : {}),
    };
  }

  // The SDK's deny arm requires a message, and the model reads it — a silent
  // deny still has to say why.
  return { behavior: 'deny', message: response.message ?? 'The user denied this tool call.' };
}
