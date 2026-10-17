/**
 * One command a session can type: a `/name` the Agent SDK dispatches from the
 * prompt string itself, so nothing about it travels on the wire as a *send* —
 * the `/` menu is an offer, and the prompt is still one string
 * (`protocol.ts`'s `SendPromptPayload`).
 *
 * The shape is the SDK's own row (`SlashCommand`, `sdk.d.ts`), and it is
 * deliberately wider than it: `description` and `argumentHint` are required
 * there and optional here, because the two sources the menu offers a list from
 * disagree about that. The SDK always fills them (with a blank string when a
 * command declares neither); the project's own files fill them only when the
 * frontmatter does. An absent field is therefore *nothing to show*, never a
 * blank to render, which is exactly the distinction the menu draws.
 *
 * `aliases` and `builtin` ride along unread: they are the SDK's own facts about
 * a row, the client renders neither, and a type that dropped them would stop
 * being the SDK's row.
 */
export interface SlashCommand {
  /** What is typed after the slash, with no slash of its own. */
  name: string;
  /** One line about what it does. Absent when nothing declares one. */
  description?: string;
  /** What the command expects after its name (`<file>`). Absent when nothing declares one. */
  argumentHint?: string;
  /** Other names that resolve to this command — a skill's directory, when its frontmatter renames it. */
  aliases?: readonly string[];
  /** True for Claude Code's own commands: no file on disk declares them. */
  builtin?: boolean;
}
