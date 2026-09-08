# Breakpoint

**Compose a system architecture, run traffic through it, and watch real
queueing-theory metrics move — live.**

`breakpoint` is an interactive, quantitatively honest system-design sandbox.
Drag out a load balancer, some API servers, a cache and a database; pick a traffic
scenario; press **Play**. Utilization, latency percentiles, queue depth, drop
rate, retry amplification and circuit-breaker state propagate through the graph in
real time. Add a replica and watch p99 recover. Delete the load balancer and watch
one server melt.

<!-- Replace OWNER with your GitHub user/org once the repo is pushed. -->
[![CI](https://github.com/OWNER/breakpoint/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/breakpoint/actions/workflows/ci.yml)
[![Deploy](https://github.com/OWNER/breakpoint/actions/workflows/deploy.yml/badge.svg)](https://github.com/OWNER/breakpoint/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[▶ Live demo](https://OWNER.github.io/breakpoint/)** &nbsp;·&nbsp;
[The math](docs/model.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

<!-- Drop a screen recording here — it does most of the selling. -->
<!-- ![demo](docs/demo.gif) -->

---

## Why this exists

System-design diagrams (Excalidraw, draw.io, Eraser) are static pictures.
Capacity calculators are spreadsheets with no picture. Interview prep and design
docs hand-wave *"what happens when you remove the load balancer?"* and *"why does
removing the cache melt the DB?"*

`breakpoint` is meant to be the tool that is **both** a live diagram **and** a
real model — close enough to the real queueing behaviour to build intuition, and
honest about where the math stops being valid.

## Watch what happens when you…

- **Delete the load balancer** → the remaining server's ρ climbs toward 1, the
  latency curve goes vertical, drops start, the node turns red.
- **Add API replicas** → offered load splits, ρ falls, p99 recovers.
- **Remove the cache** → miss ratio → 100%, database arrival rate jumps 5–10×, the
  DB becomes the bottleneck.
- **Fire a flash spike / thundering herd** → retries push `λ_eff > λ`; the
  amplification and the recovery time are both measured.
- **Switch a database to primary + read replicas / sharded / multi-primary** →
  per-instance sub-cards show each replica's load; a hot shard under a Zipfian key
  distribution is flagged.
- **Scale from the node** → `±` steppers on each card re-solve the whole system
  instantly.
- **Ask "how many users until this breaks?"** → the system grade (A–F + headroom
  multiple + "breaks around N") answers it.

Everything is emergent from editing the running graph — there are no scripted
demos.

## Two engines that must agree

Every metric is produced **twice**:

1. **Analytical solver** — closed-form M/M/1, M/M/c (Erlang C), M/M/c/K (bounded
   queue → blocking = drop rate), Erlang B/C, plus Jackson-network flow equations
   for per-node arrival rates, retry fixed-point iteration, and critical-path
   latency. Runs on every edit, instantly, in a Web Worker.
2. **Discrete-event simulation** — a seeded event-driven simulator (binary-heap
   event queue, non-homogeneous Poisson arrivals, per-request routing with
   fan-out/join, log-spaced latency histograms). Also in the Worker.

For stationary inputs the two must converge within tolerance. **That equivalence
is a CI test** and the project's core credibility claim. Same seed + same design +
same scenario ⇒ identical run.

Every formula module in `src/engine/queueing/` has a matching `*.test.ts` that
asserts against hard-coded textbook values (e.g. M/M/1 with λ=8, μ=10 → ρ=0.8,
L=4, W=0.5). See [`docs/model.md`](docs/model.md) for the models and references.

## Features

**Modelling**
- Components: client / traffic source · load balancer · API server (vCPU/RAM
  sizing, bounded queue, load shedding, autoscaling) · cache · SQL database
  (single / primary-replica / multi-primary / sharded) · queue · worker · CDN ·
  object store · external / third-party service.
- Edges carry retries, timeout, backoff, weight, calls-per-request.
- Two load models: **closed-loop** (N concurrent users + think time, solved via
  the interactive response-time law) and **open-loop** (target RPS).
- Scenarios: constant · ramp · diurnal · spike, with adjustable peak factor and
  duration.

**Working with it**
- Preset templates (URL shortener, e-commerce checkout, social feed, streaming/CDN,
  public API) + a blank canvas.
- **🎲 Random system** generator and a scenario-only randomiser, both seeded.
- Bottleneck detector with one-click fixes (re-solves patched designs to rank the
  cheapest fix that clears the SLO).
- Explain popovers on every scenario control and KPI.
- Live metrics-over-time drawer (throughput, latency p99, success rate).
- Right-click context menus, auto-layout, light / dark / system theme.

**Sharing**
- Shareable URL (design compressed into the hash), JSON import / export,
  canvas PNG / SVG, and a markdown metrics report.

## Quickstart

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173

npm test           # Vitest — includes the textbook-value + convergence checks
npm run typecheck
npm run lint
npm run build      # static site → dist/
```

Node 20+. The static build has three entry points: the landing page at `/`, the
tool at `/sandbox/`, and a read-only `embed.html`.

## Project layout

```
index.html           landing page  (served at /)
sandbox/index.html    the tool      (served at /sandbox/)
embed.html            read-only embeddable widget
src/
  engine/            no React — pure, testable
    queueing/        mm1, mmc, mmck, erlang, percentiles  (+ *.test.ts)
    components/      per-type solve() + sim spec, one file per component
    flow.ts          per-node arrival rates, retry fixed-point
    solver.ts        analytical orchestration → metrics + explain notes
    analyze.ts       bottleneck detector + cheapest-fix search + system grade
    des/             discrete-event simulator (heap, histogram, scenarios)
  worker/            the sole compute hub (analytical + DES)
  store/             Zustand: design, sim, view, theme, worker bridge
  flow/              React Flow canvas, custom nodes/edges, context menus
  ui/                TopBar, ScenarioBar, Palette, Inspector, MetricsDrawer …
  presets/           preset designs as JSON
docs/model.md        the queueing math, with citations
```

**Adding a component** = one file in `src/engine/components/`, one registry entry,
one docs paragraph. The node UI and the schema-driven inspector form are generic.

## Roadmap

Done:

- [x] Validated queueing engine (M/M/1, M/M/c, M/M/c/K, Erlang B/C, Jackson flow)
- [x] Discrete-event simulator + analytical/DES convergence tests
- [x] React Flow canvas, generic node/inspector, context menus, auto-layout
- [x] Closed-loop (users) and open-loop (RPS) load models
- [x] DB replication topologies + hot-shard detection
- [x] Bottleneck detector with one-click fixes, system grade
- [x] Presets, random generator, share URL, JSON / PNG / SVG / report export

Planned:

- [ ] Failure injection / chaos (kill node, add latency, partition edge, AZ outage)
- [ ] Multi-region / AZ containers, inter-zone latency, replication lag, quorum (R/W/N)
- [ ] Guided challenges with live pass/fail progression
- [ ] Read-only embeddable widget (`embed.html`)
- [ ] M/G/1 service-time distributions (Pollaczek–Khinchine)
- [ ] Compare mode (two designs, one scenario, metric diff)
- [ ] Cost model + SLO / error-budget panel
- [ ] Import from telemetry (Prometheus / OpenTelemetry service graph / CSV)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first
contributions: a new component model, a preset, or a guided challenge (all mostly
data). Every engine change needs a test; new formulas need a textbook-value check.

## License

MIT — see [LICENSE](LICENSE).
