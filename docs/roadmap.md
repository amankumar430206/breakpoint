# Roadmap

## Done

- Validated queueing engine — M/M/1, M/M/c, M/M/c/K, Erlang B/C, Jackson flow,
  retry fixed-point, closed-loop `λ = N/(R+Z)`
- Discrete-event simulator + analytical ⇄ DES convergence tests (the credibility
  contract)
- React Flow canvas, generic node + schema-driven inspector, context menus,
  auto-layout, vertical / horizontal flow
- Closed-loop (users) and open-loop (RPS) load; 6 scenario shapes incl. `wander`
- 11 component models incl. co-located DB, multi-instance load balancer
- DB replication topologies (single / primary-replica / multi-primary / sharded)
  + hot-shard detection
- **DB engine types** — relational / document / wide-column / managed-KV /
  in-memory / distributed-SQL, each changing the read/write cost model and what
  binds first
- **Per-attempt timeouts** — `timeoutSec` wired into both engines; timeout rate
  on the edge
- **Per-edge network latency** + real replication-lag cost on replica reads
- **Circuit breaker** — real closed ↔ open ↔ half-open state machine in both
  engines; shields the dependency, bounds caller latency
- **Design-review advisor** — CAP posture, replication, sharding, LB algorithm,
  proxy role, caching, backpressure, resilience — with "use it when" hints
- "Needs attention" pulse on the node under strain
- Bottleneck detector with one-click fixes + A–F capacity grade
- Presets, random generator, share URL, JSON / PNG / SVG / report export
- Browser-local project library, resizable/fullscreen metrics window
- Read-only embeddable widget (`embed.html`) + "copy embed code"

## Planned

- **Failure / chaos injection** — kill a node, add latency, degrade, partition an
  edge; timed or manual; graded through the same audit
- Multi-region / AZ containers — inter-zone latency matrix, quorum (R/W/N),
  zone-outage scenarios
- Guided challenges with live pass/fail progression
- M/G/1 service-time distributions (Pollaczek–Khinchine)
- Compare mode — two designs, one scenario, metric diff
- Cost model + SLO / error-budget panel
- Import from telemetry — Prometheus / OpenTelemetry service graph / CSV
