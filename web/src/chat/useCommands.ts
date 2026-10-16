import type { SlashCommand } from '@clodeck/shared';
import { useCallback, useEffect, useState } from 'react';

import { commandsOf } from './reducer';

/**
 * The project's own commands, as its files declare them: the `/` menu's source
 * **before** a run exists, and the fallback whenever the run's own list is
 * empty.
 *
 * It is a fetch rather than a constant because the answer is a directory's
 * contents — a skill installed while a session is open is a command the next
 * look finds — and it is re-read on demand for exactly that reason: the panel
 * calls `reload` every time the menu opens (ticket 75). The route reads the
 * files itself, with no cache, so a reload is a fresh answer and not a
 * remembered one.
 *
 * There is no error state, deliberately. What this feeds is a completion menu:
 * a list nobody could read, a project with no `.claude` at all, and a project
 * whose skills are still being fetched all offer the same thing — nothing — and
 * the menu says the same one line for each. An error arm nothing renders would
 * only be a state to keep alive.
 */
export interface CommandsQuery {
  commands: readonly SlashCommand[];
  /** Ask the server again — the menu's own "what is there now?". */
  reload: () => void;
}

export function useCommands(projectId: string): CommandsQuery {
  const [commands, setCommands] = useState<readonly SlashCommand[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetchCommands(projectId, controller.signal).then((offered) => {
      // An aborted request is this effect being replaced, not an answer.
      if (!controller.signal.aborted) setCommands(offered);
    }, () => {
      // Unreachable while the server is the one this client came from, and not
      // worth a surface when it is: see the type's own note.
    });

    return () => controller.abort();
  }, [projectId, attempt]);

  return { commands, reload: useCallback(() => setAttempt((count) => count + 1), []) };
}

/** `GET /api/projects/:id/commands` answers `{ commands }`. */
async function fetchCommands(projectId: string, signal: AbortSignal): Promise<readonly SlashCommand[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/commands`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`the command list answered ${String(response.status)}`);

  const body: unknown = await response.json();
  const listed: unknown = typeof body === 'object' && body !== null ? (body as { commands?: unknown }).commands : undefined;
  return commandsOf(listed);
}
