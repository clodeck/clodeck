import type { ReactElement } from 'react';

/**
 * The app shell.
 *
 * Today it is a single placeholder: the project switcher (ticket 04) and the
 * chat / terminal / file-drawer surfaces that fill this layout land later.
 */
export function App(): ReactElement {
  return (
    <main>
      <h1>Clodeck</h1>
      <p>Shell scaffold — the project switcher lands in ticket 04.</p>
    </main>
  );
}
