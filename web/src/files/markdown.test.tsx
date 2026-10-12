// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { isMarkdown, renderMarkdown } from './markdown';

/**
 * The markdown renderer on its own: a string in, React elements out. It is the
 * one place in the app that reads a file's bytes as something other than a text
 * node, which is why the second contract here matters as much as the first —
 * **a file's markup is content, never structure**. Nothing in this module builds
 * an HTML string, so there is no `innerHTML` to assert about; what the tests can
 * assert is the behaviour that would follow from one: an `<img>` in a file is
 * text on the page, not an image element.
 */

/** Every construct the renderer claims to know, in one file. */
const FIXTURE = `# Title

Some **bold**, some *italic*, some \`code\`, and a [link](https://example.com/docs).

## Section

- one
- two

1. first
2. second

> quoted
> twice

---

\`\`\`ts
const answer = 42;
\`\`\`

A paragraph
wrapped over two lines.
`;

function renderFixture(source: string): HTMLElement {
  const { container } = render(<div>{renderMarkdown(source)}</div>);
  return container;
}

afterEach(cleanup);

describe('the markdown renderer', () => {
  it('renders every construct it supports', () => {
    const container = renderFixture(FIXTURE);

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('p code')?.textContent).toBe('code');

    const link = screen.getByRole('link', { name: 'link' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    // A link in a file must never navigate the workspace away from itself.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    expect(container.querySelector('ul')).toBeTruthy();
    expect(container.querySelector('ol')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'one',
      'two',
      'first',
      'second',
    ]);

    expect(container.querySelector('blockquote')?.textContent).toBe('quotedtwice');
    expect(container.querySelector('hr')).toBeTruthy();
    // A fenced block is a `<pre>` (ticket 45's gutter and colouring are for
    // source mode), and its body is not read as markdown.
    expect(container.querySelector('pre')?.textContent).toBe('const answer = 42;');

    // Consecutive lines are one paragraph, and the two inline lines are two.
    const paragraphs = [...container.querySelectorAll('p')].map((node) => node.textContent);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]).toBe('A paragraphwrapped over two lines.');
  });

  it('renders a file’s markup as text, never as elements', () => {
    const container = renderFixture('<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>');

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  });

  it('knows which file names it applies to', () => {
    expect(isMarkdown('README.md')).toBe(true);
    expect(isMarkdown('docs/GUIDE.MD')).toBe(true);
    expect(isMarkdown('notes.md.txt')).toBe(false);
    expect(isMarkdown('main.ts')).toBe(false);
    expect(isMarkdown('md')).toBe(false);
  });
});
