import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { missingEnvFileMessage, parseEnvFile, withEnvFile } from "./dev-env.mjs";

/**
 * The loader between `.env` and the dev loop, tested on its rules rather than on
 * this machine's own file: what `.env` means is a contract three readers share
 * now (two launchers and this one), and the cases below are the ones where a
 * reader that guessed differently would still look like it worked.
 *
 * The one test that runs the command is the missing-file path, which stops before
 * anything is spawned — so the suite starts no npm, no Vite and no server.
 */

const fixtures: string[] = [];
const SCRIPT = fileURLToPath(new URL("./dev-env.mjs", import.meta.url));

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A directory to run the command in, which is what `.env` is read relative to. */
function emptyDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "clodeck-dev-env-"));
  fixtures.push(dir);
  return dir;
}

describe("the assignments in a .env file", () => {
  it("are one per line, and the lines that are not one are skipped", () => {
    const entries = parseEnvFile(
      ["# a comment", "", "   ", "no equals sign here", "UI_PASSWORD=dev", "  # indented too"].join(
        "\n",
      ),
    );

    expect(entries).toEqual([{ key: "UI_PASSWORD", value: "dev" }]);
  });

  it("split at the first `=`, so a value may contain one", () => {
    expect(parseEnvFile("TOKEN=abc=def==")).toEqual([{ key: "TOKEN", value: "abc=def==" }]);
  });

  it("trim the key and take the value verbatim", () => {
    // The asymmetry is deliberate: a space before a key is a typo, and a trailing
    // space in a password is a password.
    expect(parseEnvFile("  UI_PASSWORD = dev  ")).toEqual([{ key: "UI_PASSWORD", value: " dev  " }]);
  });

  it("keep backslashes, `#` and quotes as the characters they are", () => {
    // The whole reason for reading the file here rather than `source`-ing it: the
    // shell eats a Windows path's backslashes on the way in, and a `#` inside a
    // value would be a comment to a reader that knew about comments mid-line.
    const entries = parseEnvFile(
      ['PROJECTS_ROOT=C:\\Users\\me\\clodeck-projects', "UI_PASSWORD=p#ss", 'QUOTED="a b"'].join(
        "\n",
      ),
    );

    expect(entries).toEqual([
      { key: "PROJECTS_ROOT", value: "C:\\Users\\me\\clodeck-projects" },
      { key: "UI_PASSWORD", value: "p#ss" },
      { key: "QUOTED", value: '"a b"' },
    ]);
  });

  it("read a CRLF file exactly as an LF one", () => {
    expect(parseEnvFile("UI_PASSWORD=dev\r\nPROJECTS_ROOT=C:\\p\r\n")).toEqual(
      parseEnvFile("UI_PASSWORD=dev\nPROJECTS_ROOT=C:\\p\n"),
    );
  });
});

describe("what the loop is started with", () => {
  it("is the environment the file wins over", () => {
    const merged = withEnvFile({ UI_PASSWORD: "still-exported", PATH: "/usr/bin" }, [
      { key: "UI_PASSWORD", value: "dev" },
    ]);

    expect(merged).toEqual({ UI_PASSWORD: "dev", PATH: "/usr/bin" });
  });

  it("is the environment untouched when the file declares nothing", () => {
    expect(withEnvFile({ PATH: "/usr/bin" }, [])).toEqual({ PATH: "/usr/bin" });
  });
});

describe("a missing .env", () => {
  it("is two ways out rather than a stack trace", () => {
    const message = missingEnvFileMessage(".env");

    expect(message).toContain("setup-clodeck.sh");
    expect(message).toContain("npm run dev");
  });

  it("starts nothing, and says so with a non-zero exit", () => {
    const run = spawnSync(process.execPath, [SCRIPT], {
      cwd: emptyDirectory(),
      encoding: "utf8",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("there is no .env here");
    expect(run.stdout).toBe("");
  });
});
