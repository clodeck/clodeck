# Coding standards

What the reviewer holds a diff to, besides the ticket itself. The reviewer loads
this file, so the implementer never pays for it in tokens.

## Comments

- A comment says **why**, never what. This repo's comments are prose sentences carrying the reasoning a reader cannot recover from the code: what was rejected and on what grounds, what the constraint is, what breaks otherwise.
- Match the density of the file you are in. A dense file that suddenly explains its every line reads as though two people wrote it.
- No commented-out code and no `TODO` left in a commit.

## Types

- TypeScript strict, tests included.
- No `any`, and no `as` cast used to quiet the compiler — narrow instead.
- An unsafe cast in a function's signature is a design smell; report it rather than papering over it.

## Tests

- Vitest. Test names are sentences about behaviour, not about a function.
- Every new or changed behaviour needs a test that fails without it.
- In the web workspace, assert on accessible names and visible text — a control that loses its label is a regression even when it still works.
- A test that asserts an implementation detail is worth less than no test. Prefer the observable behaviour.

## Shape

- Keep modules focused; prefer a small named function to an inline blob.
- Prefer explicit to clever, and a switch or if/else chain to a nested ternary.
- Do not add an abstraction with one caller.
- A change that touches more than the ticket asks for is a finding, not a bonus.
