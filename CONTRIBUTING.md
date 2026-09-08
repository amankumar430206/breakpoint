# Contributing to Breakpoint

Thanks for helping build this. The project aims to be a genuinely useful,
quantitatively honest tool — contributions are judged against that bar.

## Setup

```bash
npm install
npm test          # must stay green
npm run typecheck
npm run lint
```

## Ground rules

- **The engine is framework-free.** Nothing under `src/engine/` may import React,
  Zustand, or anything DOM. It is pure TypeScript so it can run in a Web Worker
  and be tested in isolation.
- **Every formula is cited and tested.** New queueing math goes in
  `src/engine/queueing/` with a `*.test.ts` asserting against a published
  textbook value or a closed-form cross-check. Reference the source in a comment.
- **Analytical and simulated results must agree.** If you add a component, add it
  to both the analytical solver and the DES, and add a case to
  `convergence.test.ts`.

## Adding a component type

1. `src/engine/components/<type>.ts` — implement the model: `solve(node, inflow)`
   returning `{ metrics, explain }`, plus the DES `simStep` hooks.
2. `src/engine/registry.ts` — register the type with its default params and a
   Zod schema.
3. `src/flow/nodes/<Type>Node.tsx` — the React Flow node component (status colour,
   utilization bar, inline sparkline).
4. `docs/components.md` — document the params and the model, with realistic
   default values and where they come from.

## Adding a preset or a challenge

Presets are JSON in `src/presets/`; challenges are data files in
`src/challenges/`. Both are validated in CI (`presets.test.ts`,
`challenges.test.ts`) — a challenge must ship a solution that satisfies its own
success criteria.

## Commits & PRs

Small, focused commits with a clear message. Run `npm test && npm run typecheck &&
npm run lint` before pushing. PRs that touch the engine should explain the model
choice and cite sources.
