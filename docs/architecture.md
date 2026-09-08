# Architecture

```
design (Zustand)                         a SystemDesign document:
  ├─ designStore   nodes / edges / selection / flow direction     nodes[], edges[], sim{}
  ├─ simStore      scenario, seed, speed, running, faults
  ├─ viewStore     solved metrics + analysis (what the canvas reads)
  └─ themeStore    light / dark / system
        │
        │  designSignature changes  (debounced 90 ms)
        ▼
  simWorker.ts  ──postMessage──▶  worker/sim.worker.ts   ◀── the ONLY compute hub
        ▲                              │
        │                              ├─ solve(design)          analytical, instant
        │                              │     → SolveResult (perNode / perEdge / system)
        │                              ├─ analyze(design, result)  bottlenecks + fixes + grade
        │                              │     └─ advise(design, result)  design-review notes
        │                              └─ new Simulator(design)   discrete-event, seeded
        │                                    → SimSnapshot every TICK_MS (~15 Hz)
        │                                                          │
        └──────────── analysis / snapshot / ended ◀───────────────┘
                          │
                          ▼
                   viewStore.applyAnalytical / applySnapshot
                          │  (reuses prior per-node/edge objects when
                          │   unchanged at display resolution)
                          ▼
        flow/ + ui/  — React Flow canvas, node cards, panels
```

## The two engines

Every metric is computed twice and the two are asserted to agree for stationary
input (`src/engine/des/convergence.test.ts`).

| | Analytical (`solver.ts`) | Discrete-event (`des/simulator.ts`) |
| --- | --- | --- |
| method | closed-form queueing theory | seeded event-by-event simulation |
| speed | instant, on every edit | streamed, runs in the worker |
| gives | steady-state means + percentiles + `explain` notes | time series, transients, backlog growth, variance |
| shared contract | `ComponentModel.solve(ctx)` | `ComponentModel.simSpec(params)` — same params, same structure |

`solve()` runs a fixed-point iteration: solve every node downstream-first so each
sees its dependencies' error rates, recompute per-edge flow (retry amplification,
timeout probability, circuit-breaker open fraction), repeat until arrival rates
and failure rates stop moving.

## Layers

- **`src/engine/`** — no React, no DOM. Pure functions + a component registry.
  Runs under Vitest in `node` and inside the worker unchanged.
  - `queueing/` — M/M/1, M/M/c, M/M/c/K, Erlang B/C, percentile inversion. Each
    has a textbook-value test.
  - `components/` — one file per component type: `solve()`, `simSpec()`,
    `paramSchema` (Zod), `paramDocs`, routing, presets. Registered in
    `registry.ts`.
  - `flow.ts` — graph build, topological order, per-node arrival rates, retry
    fixed-point.
  - `solver.ts` — orchestrates the analytical pass → `SolveResult`.
  - `analyze.ts` — bottleneck detection, one-step fix search (re-solves each
    candidate), A–F capacity grade. Carries `advise()` output.
  - `advise.ts` — qualitative design review (CAP, replication, sharding, LB
    algorithm, proxy role, caching, backpressure, resilience).
  - `des/` — binary-heap event queue, non-homogeneous Poisson arrivals via
    thinning, log-spaced latency histograms, scenario shapes.
- **`src/worker/`** — the sole compute hub. `sim.worker.ts` owns both engines;
  `protocol.ts` types the messages (`init | play | pause | reset | setSpeed` in,
  `analysis | snapshot | ended` out).
- **`src/store/`** — Zustand stores (`Object.is` equality; `useShallow` for
  object selectors). `simWorker.ts` is the hook that debounces re-init on
  `designSignature` and fans worker messages into `viewStore`.
- **`src/flow/` + `src/ui/`** — the only React. The canvas passes the raw graph
  to React Flow; live numbers reach each node/edge through a narrow `viewStore`
  selector, so a metrics tick re-renders only the components whose displayed
  values actually moved.

## Performance contract

`applySnapshot` (~15 Hz) hands back the *previous* per-node / per-edge object
reference when nothing changed at display resolution (quantized comparators).
Combined with `React.memo` on the node/edge components and per-id selectors, a
quiescent part of the graph stops re-rendering while the sim runs. Don't widen a
selector to return a fresh object every tick.

## The build

Three static entry points, one Vite build:

| entry | file | served at |
| --- | --- | --- |
| landing | `index.html` | `/` |
| sandbox | `sandbox/index.html` | `/sandbox/` |
| embed | `embed.html` | `/embed` — read-only, no palette/inspector |
