# Components

Every component is one file in `src/engine/components/`, registered in
`registry.ts`. Each exposes a `solve(ctx)` (analytical) and a `simSpec(params)`
(discrete-event) built from the **same** params, plus a Zod `paramSchema` that
drives the inspector form automatically.

`routing` says how inflow leaves a node: **passthrough** (100% continues, split
by edge weight), **replicate** (full inflow to every downstream), **branch** (a
fraction continues, the rest short-circuits), **sink** (nothing continues).

| type | category | routing | models as | key params |
| --- | --- | --- | --- | --- |
| `client` | source | replicate | traffic source; load comes from the scenario | *(none — load is on the scenario / client controls)* |
| `loadBalancer` | network | passthrough | M/M/c, `c = instances`, `μ = capacityRps` | `algorithm`, `capacityRps`, `instances`, `latencyMs` |
| `apiGateway` | network | passthrough | admission gate at `min(instances·capacityRps, rateLimitRps)`; excess → 429 (not queued) | `capacityRps`, `instances`, `authLatencyMs`, `rateLimitRps`, `authErrorRate` |
| `apiServer` | compute | replicate | M/M/c/K per replica; `c` from vCPU × parallelism vs RAM ÷ per-req MB | `vcpus`, `ramGB`, `serviceTimeMs`, `parallelPerVcpu`, `memPerReqMB`, `replicas`, `queueLimit`, `autoscale`, `colocatedDb` (+ `dbQueryMs`, `queriesPerRequest`, `dbBufferGB`) |
| `cache` | data | branch | fast M/M/1; `outflow = 1 − hitRatio` | `hitRatio`, `hitLatencyMs`, `capacityRps` |
| `cdn` | network | branch | edge M/M/1; `outflow = 1 − offloadRatio` | `offloadRatio`, `edgeLatencyMs`, `edgeCapacityRps` |
| `sqlDatabase` | data | sink | see below | `architecture`, `engine`, `queryTimeMs`, `poolSize` / `capacityRps`, `readRatio`, `readReplicas` / `primaries` / `shards`, `replicationLagMs`, `keyDistribution` |
| `queue` | messaging | passthrough | M/M/1 at `brokerThroughputRps`; the queue *is* the buffer | `brokerThroughputRps`, `enqueueLatencyMs`, `partitions`, `retentionSec` |
| `worker` | compute | replicate | M/M/c/K per replica; `c` from vCPU × parallelism vs RAM | `jobTimeMs`, `vcpus`, `ramGB`, `parallelPerVcpu`, `replicas`, `queueLimit` |
| `objectStore` | data | sink | M/M/1 at `opsRps` | `opLatencyMs`, `opsRps` |
| `externalService` | external | sink | rate-limited M/M/1 with jitter | `latencyMs`, `jitterMs`, `rateLimitRps`, `errorRate`, `timeoutSec` |
| `circuitBreaker` | resilience | passthrough | steady-state {closed, open, half-open}; see below | `errorThresholdPct`, `windowSec`, `cooldownSec`, `halfOpenProbes`, `fallbackErrorRate`, `fastFailMs` |

## Edge params (`EdgeParams`)

| param | effect |
| --- | --- |
| `weight` | share of traffic at a weighted split (load balancer) |
| `retries` | extra attempts on a failed call — watch retry-storm amplification |
| `timeoutSec` | per-attempt timeout; `P(sojourn > timeoutSec)` on the target counts as a failed attempt in both engines |
| `backoffSec` | delay between retries (DES) |
| `netLatencyMs` | fixed one-way hop latency; adds once to the critical-path latency |
| `callsPerRequest` | fan-out — downstream calls per upstream request |

## `sqlDatabase` — architecture × engine

**`architecture`** picks the replication topology:

- `single` — one node, all reads + writes. CP, SPOF.
- `primary-replica` — writes → primary, reads spread across `readReplicas`
  async replicas. Replica reads pay a staleness wait `≈ replicationLagMs ·
  (1 − readRatio) · ½` (read-your-writes).
- `multi-primary` — `primaries` nodes all take reads + writes; each write is
  certified across the other N−1, so per-node write rate drops with
  `writeCoordinationPct`.
- `sharded` — `shards` independent partitions; capacity scales ~linearly.
  `keyDistribution: zipfian` concentrates load on one **hot shard**;
  `crossShardPct` of queries scatter-gather to every shard.

**`engine`** picks the storage engine, orthogonally — it scales the read/write
service time and changes what binds first (`DB_ENGINES` in `sqlDatabase.ts`):

| engine | read× | write× | binds on | CAP | notes |
| --- | --- | --- | --- | --- | --- |
| `postgres` / `mysql` | 1.0 | 1.0 | connection pool | CP | balanced; sharding is bolt-on |
| `mongodb` | 0.7 | 1.1 | throughput | AP | denormalized reads cheaper; native sharding |
| `cassandra` | 1.5 | 0.4 | throughput | AP | LSM: cheap writes, read amplification |
| `dynamodb` | 0.8 | 1.0 | throughput | AP | capacity units; hot-partition risk |
| `redis` | 0.15 | 0.2 | throughput | AP | in-memory; durability trade-off |
| `cockroachdb` | 1.1 | 1.3 | pool | CP | +consensus latency on writes; scale-out built in |
| `prometheus` / `influxdb` / `timescale` | 1.2–2.0 | 0.08–0.25 | throughput | AP | time-series: ingest is nearly free, range/downsample reads cost more |

Pool engines size on `poolSize · μ`; throughput engines size on `capacityRps`.

## `circuitBreaker`

Wraps a flaky dependency. Given the dependency's failure rate `f`, the
steady-state open fraction is

```
pOpen ≈ trip(f) · cooldownSec / (cooldownSec + (1 − f)^halfOpenProbes · windowSec)
```

`outflowFraction = 1 − pOpen` — the open fraction never reaches the dependency
(it is **shielded**), and the caller fast-fails in `fastFailMs` instead of
waiting for a timeout (caller latency is **bounded**). The DES runs the real
closed ↔ open ↔ half-open machine with a rolling error window and probe
accounting. See [`concepts.md#circuit-breakers`](concepts.md#circuit-breakers).

## The math

Queueing formulas, percentile inversion, and the co-located-DB model are in
[`model.md`](model.md).
