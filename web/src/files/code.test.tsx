// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeView, highlightLine, languageOf } from './code';

/**
 * The code view's two contracts: the highlighter is a pure `line + language →
 * segments` function (the prototype's rough pass, unit-tested here), and the
 * view that draws it puts those segments — and a file's own markup — in React
 * text nodes. Nothing in `code.tsx` builds an HTML string, so there is no
 * `innerHTML` to assert about; what can be asserted is the behaviour that would
 * follow from one: a `<script>` in a file is text on the page.
 */

afterEach(() => {
  cleanup();
});

describe('the language map', () => {
  it('names the prototype’s extensions, and nothing for the rest', () => {
    expect(languageOf('main.ts')).toBe('code');
    expect(languageOf('index.tsx')).toBe('code');
    expect(languageOf('app.py')).toBe('code');
    expect(languageOf('README.md')).toBe('markdown');
    expect(languageOf('notes.markdown')).toBe('markdown');

    // Past the reference on purpose: its `langFor` fell back to TypeScript, so a
    // file with no colour to claim was tinted as though it had one.
    expect(languageOf('notes.txt')).toBeNull();
    expect(languageOf('Makefile')).toBeNull();
    expect(languageOf('.bashrc')).toBeNull();
  });
});

describe('one code line, coloured roughly', () => {
  it('splits a comment, a string, a keyword and a number into their own segments', () => {
    expect(highlightLine("const answer = 42; // 'tis", 'code')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' answer = ', kind: 'plain' },
      { text: '42', kind: 'number' },
      { text: '; ', kind: 'plain' },
      { text: "// 'tis", kind: 'comment' },
    ]);
  });

  it('keeps a keyword inside a string a string, and a comment to the end of the line', () => {
    expect(highlightLine('const s = "return 2"', 'code')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' s = ', kind: 'plain' },
      { text: '"return 2"', kind: 'string' },
    ]);
    expect(highlightLine('`const x = 1`', 'code')).toEqual([{ text: '`const x = 1`', kind: 'string' }]);
    expect(highlightLine('// "not a string"', 'code')).toEqual([
      { text: '// "not a string"', kind: 'comment' },
    ]);
  });

  it('leaves an empty line one plain (empty) segment, so the row is still a row', () => {
    expect(highlightLine('', 'code')).toEqual([{ text: '', kind: 'plain' }]);
  });

  it('never claims anything for a language nothing lists', () => {
    expect(highlightLine('# not markdown', null)).toEqual([{ text: '# not markdown', kind: 'plain' }]);
  });
});

describe('markdown source, coloured by its own three shapes', () => {
  it('takes a heading and a quote whole, and splits a bold run out of a line', () => {
    expect(highlightLine('# Title', 'markdown')).toEqual([{ text: '# Title', kind: 'keyword' }]);
    expect(highlightLine('> quoted', 'markdown')).toEqual([{ text: '> quoted', kind: 'comment' }]);
    expect(highlightLine('a **b** c', 'markdown')).toEqual([
      { text: 'a ', kind: 'plain' },
      { text: '**b**', kind: 'string' },
      { text: ' c', kind: 'plain' },
    ]);
  });

  it('keeps a bold run bold inside a heading, which is what the prototype’s nesting did', () => {
    expect(highlightLine('## **Bold** head', 'markdown')).toEqual([
      { text: '## ', kind: 'keyword' },
      { text: '**Bold**', kind: 'string' },
      { text: ' head', kind: 'keyword' },
    ]);
  });
});

describe('a file’s markup is content, never structure', () => {
  const HOSTILE = '<script>alert("x")</script> & <b>bold</b>';

  it('hands the line back as its own text, untouched', () => {
    // Nothing is escaped, stripped or rewritten here: the segments carry exactly
    // the characters the file holds, and the renderer below is what makes them
    // text rather than markup.
    for (const language of ['code', 'markdown', null] as const) {
      expect(highlightLine(HOSTILE, language).map((segment) => segment.text).join('')).toBe(HOSTILE);
    }
  });

  it('renders it as text on the page, with no element built from it', () => {
    const { container } = render(<CodeView content={HOSTILE} name="x.html" />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain(HOSTILE);
  });
});
