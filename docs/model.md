# The model

Breakpoint computes every metric two ways and checks that they agree:

1. an **analytical solver** — closed-form queueing theory, evaluated instantly on
   every edit;
2. a **discrete-event simulation** (DES) — seeded, event-by-event, run in a Web
   Worker.

This document covers the analytical layer. Notation:

| symbol | meaning |
| --- | --- |
| λ | arrival rate into a node (requests / second) |
| μ | per-server service rate = 1 / mean service time |
| c | servers / concurrency slots / pool connections at a node |
| K | system capacity (in service + queued) for bounded nodes |
| a = λ/μ | offered load, in erlangs |
| ρ = a/c = λ/(cμ) | utilization per server (traffic intensity) |

A node is **stable** when ρ < 1 (unbounded queue) or always (bounded queue —
excess arrivals are dropped). At ρ ≥ 1 with an unbounded queue there is no steady
state; the UI shows the latency-→-∞ curve and the DES-measured backlog growth
rate instead.

## Building blocks — `src/engine/queueing/`

### Erlang B — `erlang.ts`

Blocking probability of an M/M/c/c loss system, via the stable recursion

```
B(0, a) = 1
B(k, a) = a·B(k-1, a) / (k + a·B(k-1, a))
```

### Erlang C — `erlang.ts`

Probability an arriving request must wait in an M/M/c queue, from Erlang B:

```
C(c, a) = c·B(c, a) / (c − a·(1 − B(c, a)))     for a < c;   1 otherwise
```

### M/M/1 — `mm1.ts`

```
ρ  = λ/μ
L  = ρ/(1−ρ)          Lq = ρ²/(1−ρ)
W  = 1/(μ−λ)          Wq = ρ/(μ−λ)
```

Sojourn time is exponential: `P(T > t) = e^{−(μ−λ)t}`, so the exact q-quantile is
`t_q = −ln(1−q)/(μ−λ)`.

### M/M/c — `mmc.ts`

```
Pw = C(c, a)                       (Erlang C)
Lq = Pw · ρ/(1−ρ)                  Wq = Pw/(cμ − λ)
W  = Wq + 1/μ                      L  = Lq + a
```

Exact sojourn-time survival function, with β = cμ − λ:

```
P(T > t) = (1−Pw)·e^{−μt} + Pw · (μ·e^{−βt} − β·e^{−μt}) / (μ − β)
```

This reduces to the M/M/1 form when c = 1. When β ≈ μ the two exponential rates
coincide and the Erlang-2 limit `(1 + μt)·e^{−μt}` is used. Percentiles come from
numerically inverting this survival function (bisection, `percentiles.ts`).

### M/M/c/K — `mmck.ts`

Bounded system. State probabilities (a = λ/μ, ρ = a/c):

```
p_n = p_0 · a^n / n!                    0 ≤ n < c
p_n = p_0 · (a^c/c!) · ρ^{n−c}          c ≤ n ≤ K
p_0 = 1 / [ Σ_{n<c} a^n/n! + (a^c/c!)·Σ_{j=0}^{K−c} ρ^j ]
```

```
pBlock = p_K
λ_eff  = λ·(1 − pBlock)
L = Σ n·p_n     Lq = Σ_{n≥c} (n−c)·p_n
W = L/λ_eff     Wq = Lq/λ_eff
```

Mean metrics and blocking are exact. Percentiles reuse the M/M/c survival function
evaluated at the accepted load λ_eff — a standard approximation; results carry
`approxPercentiles: true`.

## References

- L. Kleinrock, *Queueing Systems, Volume 1: Theory*, Wiley, 1975.
- M. Harchol-Balter, *Performance Modeling and Design of Computer Systems*,
  Cambridge University Press, 2013.
- D. Gross, J. Shortle, J. Thompson, C. Harris, *Fundamentals of Queueing
  Theory*, 4th ed., Wiley, 2008.
