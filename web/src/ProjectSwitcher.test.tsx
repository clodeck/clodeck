// @vitest-environment jsdom
import type { Project } from '@clodeck/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectSwitcher } from './ProjectSwitcher';
import { dirsAbove, nameCell } from './testing/direction';
import { ToastProvider } from './toast/ToastProvider';

/**
 * A project row's display, beside the component that draws it — the sidebar's
 * half of ticket 56.
 *
 * The switcher's *flows* (the create, the refusal that stays in its dialog) are
 * driven through the real shell in `App.projects.test.tsx`, because the fetch and
 * the auth seam are what those tests are about. What is left for here is the row
 * itself, rendered from a list: a project whose directory name is not Latin reads
 * in its own direction, and the row around the name is the row it was — its path
 * tooltip, its tone, its `aria-current`.
 */

const alpha: Project = { id: 'AAA', name: 'alpha', path: '/projects/alpha' };

/** A project directory named in a script that runs the other way. */
const persian: Project = { id: 'BBB', name: 'یادداشت', path: '/projects/یادداشت' };

function noop(): void {
  // What the switcher is *for* is not what this file is about.
}

function renderSwitcher(projects: Project[]): void {
  render(
    <ToastProvider>
      <ProjectSwitcher
        state={{ status: 'ready', projects }}
        selectedId={null}
        onSelect={noop}
        onRefresh={noop}
        onCreate={() => Promise.resolve()}
      />
    </ToastProvider>,
  );
}

afterEach(() => {
  // No vitest globals, so testing-library's auto-cleanup is not registered.
  cleanup();
});

describe('a project row', () => {
  it('draws a non-Latin name in its own order, with the sidebar around it unchanged', () => {
    renderSwitcher([alpha, persian]);

    const row = screen.getByRole('button', { name: persian.name });

    // The rule is on the name's own element, and nowhere between the row and the
    // sidebar: the list's layout keeps the direction it is laid out in, so the
    // script a name starts with cannot move a row.
    expect(nameCell(row).getAttribute('dir')).toBe('auto');
    expect(dirsAbove(row)).toEqual([]);

    // Display-only: the name is drawn exactly as the list carried it, and the row
    // still addresses the path it always did.
    expect(nameCell(row).textContent).toBe(persian.name);
    expect(row.getAttribute('title')).toBe(persian.path);
    expect(row.getAttribute('aria-current')).toBe('false');
  });

  it('draws a Latin name exactly as it did before', () => {
    // The Latin row is in the *same* list as the Persian one, so nothing of this
    // is the Persian row's to change.
    renderSwitcher([alpha, persian]);

    const row = screen.getByRole('button', { name: alpha.name });

    // The rule is on this name too, and the browser's first-strong rule resolves
    // it left-to-right — the direction it resolved before this change.
    expect(nameCell(row).getAttribute('dir')).toBe('auto');
    expect(dirsAbove(row)).toEqual([]);
    expect(nameCell(row).textContent).toBe(alpha.name);
    expect(row.getAttribute('title')).toBe(alpha.path);
  });
});
