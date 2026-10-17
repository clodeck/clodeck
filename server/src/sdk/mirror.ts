import type { SDKMessage as RealSDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
  SDKMessage,
  SDKSystemCommandsChangedMessage,
  SDKSystemInitMessage,
  SDKSystemSessionStateChangedMessage,
  SDKSystemStatusMessage,
} from '@clodeck/shared';

/**
 * The pin. `@clodeck/shared` cannot import the Agent SDK (it would drag a native
 * binary into the web bundle), so the mirror there is hand-written and this
 * module is the only place the two meet: every `case` assigns a real SDK family
 * to the mirrored family, so `tsc` fails here the moment the mirror is narrower
 * than the SDK (a new required field, a literal the mirror typed as `string`).
 *
 * `import type` is deliberate — the assignment is checked at compile time and
 * nothing is imported at runtime, so this stays free of the SDK's binary.
 *
 * `system` and `result` discriminate a second level (`subtype`), so those go to
 * a helper each; everything the client neither renders nor acts on returns
 * `null`.
 */
export function narrowToMirror(message: RealSDKMessage): SDKMessage | null {
  switch (message.type) {
    case 'assistant':
      return message;

    case 'user':
      return message;

    case 'tool_progress':
      return message;

    case 'stream_event':
      return message;

    // Not rendered, but acted on: the SDK discarded the conversation and the
    // client drops the transcript on screen with it (ticket 76).
    case 'conversation_reset':
      return message;

    case 'system':
      return narrowSystem(message);

    case 'result':
      return narrowResult(message);

    default:
      return null;
  }
}

/** The `system` arm of `SDKMessage`, with `type` already fixed by the caller. */
type RealSystemMessage = Extract<RealSDKMessage, { type: 'system' }>;

/**
 * The second discriminant. Every `system` member is `type: 'system'` and
 * narrows only on `subtype`; the client renders four of them and folds the
 * other ~25 into `SDKSystemOtherMessage`.
 *
 * The named arms assign to an annotated target rather than returning straight
 * into `SDKMessage`: the catch-all arm types `subtype` as `string`, so it would
 * absorb any `system` message and a `return message` would check nothing. The
 * annotation is what pins each arm's *shape*. A fourth arm added here must be
 * annotated the same way.
 */
function narrowSystem(message: RealSystemMessage): SDKMessage {
  switch (message.subtype) {
    case 'init': {
      const mirrored: SDKSystemInitMessage = message;
      return mirrored;
    }

    case 'status': {
      const mirrored: SDKSystemStatusMessage = message;
      return mirrored;
    }

    case 'session_state_changed': {
      const mirrored: SDKSystemSessionStateChangedMessage = message;
      return mirrored;
    }

    case 'commands_changed': {
      // The push the client folds as a *replacement* of its command list
      // (ticket 75). It is annotated like the two above, so a renamed field —
      // `commands` is the whole payload — fails the build rather than reaching
      // the client as a message it can no longer read.
      const mirrored: SDKSystemCommandsChangedMessage = message;
      return mirrored;
    }

    default:
      return message;
  }
}

/** The `result` arm of `SDKMessage`, with `type` already fixed by the caller. */
type RealResultMessage = Extract<RealSDKMessage, { type: 'result' }>;

/**
 * `result`'s second discriminant. Splitting it keeps the success arm pinned to
 * the mirror arm that requires `result: string`, and the error arms to the one
 * that requires `errors: string[]` — a real subtype the mirror does not list
 * falls to `default` and fails to assign.
 */
function narrowResult(message: RealResultMessage): SDKMessage {
  switch (message.subtype) {
    case 'success':
      return message;

    default:
      return message;
  }
}
