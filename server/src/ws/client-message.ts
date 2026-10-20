import type {
  ApprovalResponsePayload,
  PermissionMode,
  ResumePayload,
  SendPromptPayload,
} from '@clodeck/shared';

/**
 * Parsing inbound frames. The wire is untrusted JSON, so a message becomes a
 * typed intent only after its payload is checked; anything else is `null` and
 * the bus answers `invalid_message`. Kept out of `bus.ts` because this is where
 * the wire shape and the shared payload types meet, and that is worth reading on
 * its own.
 */
export type ClientIntent =
  | { type: 'send_prompt'; payload: SendPromptPayload }
  | { type: 'interrupt' }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'approval_response'; response: ApprovalResponsePayload }
  | { type: 'resume'; target: ResumePayload }
  | { type: 'clear_resume' };

export function parseClientMessage(raw: string): ClientIntent | null {
  const message = parseObject(raw);
  if (message === null) return null;

  switch (message['type']) {
    case 'send_prompt': {
      const payload = asObject(message['payload']);
      const prompt = payload?.['prompt'];
      if (typeof prompt !== 'string') return null;
      // Absent is the default profile; anything else present must be a name, so
      // a client cannot ask for a profile with, say, an object.
      const profile = payload?.['profile'];
      if (profile !== undefined && typeof profile !== 'string') return null;
      // Absent leaves the run's stored mode alone; present must be a mode the
      // contract offers, or the frame is refused rather than forwarded.
      const permissionMode = payload?.['permissionMode'];
      if (permissionMode !== undefined && !isSelectablePermissionMode(permissionMode)) return null;
      return {
        type: 'send_prompt',
        payload: {
          prompt,
          ...(profile === undefined ? {} : { profile }),
          ...(permissionMode === undefined ? {} : { permissionMode }),
        },
      };
    }
    case 'interrupt':
      return { type: 'interrupt' };
    // Carries nothing to read: the project is the socket's, and the clear is the
    // whole of the message.
    case 'clear_resume':
      return { type: 'clear_resume' };
    case 'set_permission_mode': {
      const payload = asObject(message['payload']);
      const mode = payload?.['mode'];
      if (!isSelectablePermissionMode(mode)) return null;
      return { type: 'set_permission_mode', mode };
    }
    case 'approval_response': {
      const response = parseApprovalResponse(asObject(message['payload']));
      if (response === null) return null;
      return { type: 'approval_response', response };
    }
    case 'resume': {
      const target = parseResume(asObject(message['payload']));
      if (target === null) return null;
      return { type: 'resume', target };
    }
    default:
      return null;
  }
}

/** `continue` names no session; by-id optionally branches the history. */
function parseResume(payload: Record<string, unknown> | null): ResumePayload | null {
  if (payload === null) return null;
  if (payload['mode'] === 'continue') return { mode: 'continue' };

  const sessionId = payload['sessionId'];
  if (typeof sessionId !== 'string') return null;
  const fork = payload['fork'];
  if (fork !== undefined && typeof fork !== 'boolean') return null;
  return fork === undefined ? { sessionId } : { sessionId, fork };
}

/**
 * Allow and deny are the two the UI sends, but the payload's optional fields —
 * an edited input, echoed permissions, a deny reason — are forwarded as they
 * arrived rather than re-built, so nothing the client sends is quietly dropped.
 */
function parseApprovalResponse(
  payload: Record<string, unknown> | null,
): ApprovalResponsePayload | null {
  if (payload === null) return null;

  const requestId = payload['requestId'];
  const behavior = payload['behavior'];
  if (typeof requestId !== 'string') return null;
  if (behavior !== 'allow' && behavior !== 'deny') return null;

  const response: ApprovalResponsePayload = { requestId, behavior };
  const updatedInput = asObject(payload['updatedInput']);
  if (updatedInput !== null) response.updatedInput = updatedInput;
  const updatedPermissions = asArray(payload['updatedPermissions']);
  if (updatedPermissions !== null) response.updatedPermissions = updatedPermissions;
  const message = payload['message'];
  if (typeof message === 'string') response.message = message;
  return response;
}

/**
 * The modes the wire accepts, not the whole `PermissionMode` union. `auto` and
 * `dontAsk` are refused for good — `dontAsk` never reaches the modal, so its
 * refusals would look like a hang — and `bypassPermissions` is held back until
 * ticket 85 builds its gates (ADR 0003). The shared type stays the six-value
 * mirror of the SDK; this is the narrower contract the product offers.
 *
 * `satisfies Partial<Record<PermissionMode, true>>` is the link back to
 * `shared/src/sdk.ts`: a renamed mode, or one added outside the union, fails the
 * build here rather than going silently unsupported on the wire.
 */
const SELECTABLE_PERMISSION_MODES = {
  default: true,
  acceptEdits: true,
  plan: true,
} satisfies Partial<Record<PermissionMode, true>>;

type SelectablePermissionMode = keyof typeof SELECTABLE_PERMISSION_MODES;

function isSelectablePermissionMode(value: unknown): value is SelectablePermissionMode {
  // `hasOwn`, not `in`: a value like `toString` must be rejected, not found on
  // the prototype and accepted.
  return typeof value === 'string' && Object.hasOwn(SELECTABLE_PERMISSION_MODES, value);
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}
