# 43: Markdown files can be read as markdown

**What to build:** Every file renders as plain text, so a `.md` file — the most common thing anyone
opens in a project folder — is read as source. Add the prototype's `Preview ⇄ Source` toggle for
markdown files.

**Blocked by:** 36

**Status:** ready-for-agent

- [ ] A `Preview ⇄ Source` control appears in the code column's head only when the selected file is
      markdown, and is absent for every other file type. The label names the mode the click will switch
      to, and the control's state is exposed to assistive tech.
- [ ] Preview renders the markdown the server returned: headings, bold, italic, inline code, links,
      paragraphs, ordered and unordered lists, blockquotes, horizontal rules and fenced code blocks.
- [ ] **It renders as React elements, not as injected HTML, and adds no dependency.** The file's bytes
      are untrusted and the whole viewer renders them as text nodes today (`spec-04`); building a real
      HTML string and setting it would be the one place in the app that executes file content. A small
      element-producing renderer over the same subset keeps that posture and costs one module.
- [ ] What is previewed is exactly what the server sent, including the truncation note for a large file
      — the editor does not fetch the whole file to preview it.
- [ ] Links open in a new tab with `noopener noreferrer`; a link in a file never navigates the app away
      from the workspace.
- [ ] The fenced-code blocks render as plain `<pre>` in this ticket; ticket 45's gutter and colouring
      apply to **source** mode only.
- [ ] Tests: the renderer is pure (`string → elements`) and unit-tested over a fixture covering each
      supported construct; a test asserts nothing is injected as HTML; and a rendered test asserts the
      toggle appears for `.md` and not for `.ts`.

## Reference

Prototype renderer and toggle: `prototype/common.js:121-173`, `:698-700`, and the `lang === 'md'` gate
at `prototype/variant-a.js:110-111`. Current viewer: `web/src/files/FilePanel.tsx`'s preview pane.
Parity item: D3 #16 (promoted from out-of-MVP by decision D3 on 2026-10-12).
