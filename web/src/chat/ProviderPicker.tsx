import { DEFAULT_PROFILE } from '@clodeck/shared';
import { useState, type ReactElement } from 'react';

import type { ProfilesState } from './useProfiles';

/**
 * The profile this session runs on, beside the composer — adjacent to where the
 * prompt is typed, and thumb-reachable on a phone (ticket 66, decision 11).
 *
 * It says what is running **now**, never what a session *is*: the choice is
 * client state that a reload loses, so "running on X" is the most the surface
 * can honestly claim, and it is what the ticket asks for (decision 10). The line
 * is the whole button, which makes the accessible name read the same sentence a
 * sighted user reads.
 *
 * It also says when a project pins its provider, in the words of what that does
 * — the endpoint and the credential stay the project's — rather than in the words
 * of the file. And because a vendor's model name means nothing at another
 * vendor's endpoint, a pinned project is offered its **tiers** only (decision 9);
 * the server enforces the same rule on the wire regardless of what this list
 * says, so a bug here can offer a useless choice but never a mixed pair.
 *
 * The two states it can be in are the ones the rest of the shell already uses: a
 * control that cannot do its job is *disabled* and carries the reason in a
 * `title` (the rail's rule, ticket 57), and the list is a popup that closes on
 * Escape or on a click anywhere else (the file row's menu).
 */

/** What an absent model means (ticket 66, decision 13): the endpoint decides, not clodeck. */
const ENDPOINT_DECIDES = 'the endpoint decides';

/** Why the control is shut, in the two places a reader arrives from (see `App.tsx`'s rail). */
const LOCKED_REASON = 'a turn has already run in this session, so the profile is set';

/** Why a pinned project's choice is a model and nothing else (ADR 0002, in the user's words). */
const PINNED_REASON =
  'this project pins its endpoint and credential in .claude/settings.json, so a session can only choose the model';

interface ProviderPickerProps {
  state: ProfilesState;
  /** The profile the next send will ask for. */
  name: string;
  /** True once a turn has run: the choice for this session is already made. */
  locked: boolean;
  onChoose: (name: string) => void;
  onReload: () => void;
}

export function ProviderPicker({
  state,
  name,
  locked,
  onChoose,
  onReload,
}: ProviderPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  // Derived, not stored: a lock that arrives while the list is open shuts it,
  // without an effect racing the render that locked it.
  const showing = open && !locked;

  const profiles = state.status === 'ready' ? state.profiles : [];
  // What this project may be offered: everything, or the tiers alone when it pins
  // its own endpoint and credential.
  const pinned = state.status === 'ready' && state.pinned;
  const offered = pinned ? profiles.filter((profile) => profile.shape === 'tier') : profiles;
  const endpoint = state.status === 'ready' ? state.endpoint : undefined;
  // The label is answered from the whole list, not the offered one: a session may
  // still be on a profile this project would no longer offer, and the line has to
  // say what it is running on rather than pretend it is something else.
  const chosen = profiles.find((profile) => profile.name === name);
  // An absent model can only be reported as the endpoint's decision once the
  // list has arrived to say so; before that there is nothing to say at all.
  const model = state.status === 'ready' ? ` · ${chosen?.model ?? ENDPOINT_DECIDES}` : '';

  return (
    // The key handler is here rather than on the list: the trigger is what holds
    // focus after it opens the list, and a keydown from it bubbles to this div.
    <div
      className="relative flex flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <span title={locked ? LOCKED_REASON : undefined}>
        <button
          type="button"
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={showing}
          title={locked ? LOCKED_REASON : 'choose the profile this session runs on'}
          onClick={() => {
            setOpen((was) => !was);
          }}
          className="rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-white/5 disabled:opacity-60"
        >
          {`running on ${label(name)}${model}`}
        </button>
      </span>

      {pinned && (
        // The endpoint is the one half of a pin a browser may be shown: the user
        // can read the same file in the drawer (decision 14). It goes in the text
        // rather than a tooltip because the phone is what this control is for.
        <span
          title={PINNED_REASON}
          className="inline-block max-w-[18rem] truncate text-[11px] text-accent"
        >
          {endpoint === undefined ? 'pinned by this project' : `pinned by this project · ${endpoint}`}
        </span>
      )}

      {state.status === 'error' && (
        <span className="flex items-center gap-2 text-[11px] text-ink-dim">
          profiles unavailable
          <button
            type="button"
            onClick={onReload}
            className="rounded border border-line px-2 py-0.5 text-ink hover:bg-white/5"
          >
            Retry
          </button>
        </span>
      )}

      {showing && (
        <>
          <button
            type="button"
            aria-label="Close profile list"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <ul
            role="listbox"
            aria-label="Provider profile"
            className="absolute bottom-full left-0 z-20 mb-1 flex w-72 flex-col rounded border border-line bg-panel py-1 shadow-lg"
          >
            {offered.map((profile) => (
              <li key={profile.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={profile.name === name}
                  // The name is what the wire carries; the label is what it means
                  // to a reader, and for the reserved profile the two differ.
                  title={profile.name}
                  onClick={() => {
                    onChoose(profile.name);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-1 text-left text-[11px] hover:bg-white/5 ${
                    profile.name === name ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {`${label(profile.name)} · ${profile.model ?? ENDPOINT_DECIDES}`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * What a profile is called on screen. The reserved profile is this server's own
 * environment, which is what it is (ticket 66, decision 13) — `default` names
 * the mechanism, and the mechanism is not what the user is choosing.
 */
function label(name: string): string {
  return name === DEFAULT_PROFILE ? 'server environment' : name;
}
