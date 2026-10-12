import type { ReactNode } from 'react';

/**
 * A small markdown renderer, and the only place the viewer reads a file's bytes
 * as anything but text.
 *
 * **It produces React elements, not HTML.** The file is untrusted (`spec-04`:
 * every byte the app shows is a text node, and there is no `innerHTML` anywhere);
 * building an HTML string here and setting it would be the one place in the app
 * that executes file content, so the renderer returns elements instead and pays
 * for it with this module — no dependency, and no way to inject anything:
 * `<img onerror=…>` in a file is text on the page.
 *
 * The subset is the prototype's (`common.js:121-173`), which is the subset a
 * project's README actually uses: headings, bold, italic, inline code, links,
 * paragraphs, ordered and unordered lists, blockquotes, horizontal rules and
 * fenced code blocks. A fenced block is a plain `<pre>`; ticket 45's gutter and
 * highlighting are for source mode.
 *
 * Both halves are pure — `string → elements` — so they are tested without a
 * panel around them, and `renderMarkdown` is not a component: it is called
 * during a render like any other expression.
 */

/** The two extensions the world writes markdown with. */
export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/**
 * One inline run: bold, inline code, a link, or italic — in that order, so
 * `**bold**` is never read as two italics. The alternatives are ordered by what
 * they must beat, and every body is required to be non-empty, so the scan always
 * advances.
 */
const INLINE =
  /(?<bold>\*\*(?<boldText>[^*]+)\*\*)|(?<code>`(?<codeText>[^`]+)`)|(?<link>\[(?<linkText>[^\]]+)\]\((?<href>[^)\s]+)\))|(?<em>\*(?<emText>[^*\s][^*]*)\*)/g;

/** A heading: one to six `#`, then its text. */
const HEADING = /^(#{1,6})\s+(.*)$/;
/** The six heading tags, by depth — the only tag names a heading may become. */
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
/** A horizontal rule: three or more `-` or `*`. */
const RULE = /^\s*(?:-{3,}|\*{3,})\s*$/;
/** A fenced code block's fence, with or without an info string. */
const FENCE = /^\s*```/;
/** A blockquote line. */
const QUOTE = /^\s*>\s?/;
/** An unordered list item. */
const BULLET = /^\s*[-*]\s+(.*)$/;
/** An ordered list item. */
const NUMBER = /^\s*\d+\.\s+(.*)$/;

/**
 * A markdown document as a list of block elements. Blocks are found a line at a
 * time, mirroring the prototype's line loop: a construct either consumes lines
 * until it ends (a fence, a list, a blockquote) or is one line (a heading, a
 * rule), and anything else accumulates into a paragraph that a blank line, a
 * fence or another block start ends.
 */
export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (FENCE.test(line)) {
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      // The closing fence, and no more: an unterminated block ends with the file.
      index += 1;
      blocks.push(
        <pre key={blocks.length} className="my-2 overflow-x-auto rounded bg-white/5 p-2 font-mono text-[11px] text-ink">
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      // The tag is picked from real element names, not cast into one: a heading
      // deeper than six `#` is not a heading the HTML has a tag for.
      const Heading = HEADINGS[level - 1] ?? 'h6';
      blocks.push(
        <Heading key={blocks.length} className={`my-2 font-semibold text-ink ${headingSize(level)}`}>
          {inline(text)}
        </Heading>,
      );
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={blocks.length} className="my-3 border-t border-line" />);
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: ReactNode[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        if (body.length > 0) body.push(<br key={body.length} />);
        body.push(...inline((lines[index] ?? '').replace(QUOTE, '')));
        index += 1;
      }
      blocks.push(
        <blockquote key={blocks.length} className="my-2 border-l-2 border-line pl-3 text-ink-dim">
          {body}
        </blockquote>,
      );
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBER.exec(line);
    if (bullet !== null || numbered !== null) {
      const ordered = bullet === null;
      const items: ReactNode[] = [];
      for (;;) {
        const next = ordered ? NUMBER.exec(lines[index] ?? '') : BULLET.exec(lines[index] ?? '');
        if (next === null) break;
        items.push(
          <li key={items.length} className="my-0.5">
            {inline(next[1] ?? '')}
          </li>,
        );
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={blocks.length} className={`my-2 pl-5 text-[12px] text-ink ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items}
        </List>,
      );
      continue;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // A paragraph: until a blank line or the start of another block.
    const paragraph: ReactNode[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (next.trim() === '' || HEADING.test(next) || RULE.test(next) || FENCE.test(next) || QUOTE.test(next)) break;
      if (BULLET.test(next) || NUMBER.test(next)) break;
      if (paragraph.length > 0) paragraph.push(<br key={paragraph.length} />);
      paragraph.push(...inline(next));
      index += 1;
    }
    blocks.push(
      <p key={blocks.length} className="my-2 text-[12px] leading-relaxed text-ink">
        {paragraph}
      </p>,
    );
  }

  return blocks;
}

/** A heading's size, by depth: the six levels in three steps. */
function headingSize(level: number): string {
  if (level === 1) return 'text-lg';
  if (level === 2) return 'text-base';
  return level === 3 ? 'text-sm' : 'text-[12px]';
}

/**
 * One line's inline markup, as elements. Recursion is how nesting works —
 * `**bold with `code`**` — and it is safe because `matchAll` clones the pattern
 * instead of sharing its position.
 */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let end = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > end) nodes.push(text.slice(end, at));
    end = at + match[0].length;

    const groups = match.groups ?? {};
    if (groups['boldText'] !== undefined) {
      nodes.push(<strong key={nodes.length}>{inline(groups['boldText'])}</strong>);
    } else if (groups['codeText'] !== undefined) {
      nodes.push(
        <code key={nodes.length} className="rounded bg-white/10 px-1 font-mono text-[11px]">
          {groups['codeText']}
        </code>,
      );
    } else if (groups['linkText'] !== undefined) {
      // `rel="noopener noreferrer"` and a new tab: a link in a file must not be
      // able to take the workspace's own tab with it.
      nodes.push(
        <a
          key={nodes.length}
          href={groups['href'] ?? ''}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          {inline(groups['linkText'])}
        </a>,
      );
    } else if (groups['emText'] !== undefined) {
      nodes.push(<em key={nodes.length}>{inline(groups['emText'])}</em>);
    }
  }

  if (end < text.length) nodes.push(text.slice(end));
  return nodes;
}
