# System-design concepts

A short primer on the patterns Breakpoint's **Design review** advisor points at.
Each section ends with a *use it when…* line. This is deliberately compact — it is
a map, not a textbook.

---

<a id="cap"></a>

## CAP & PACELC

A distributed store, **when a network partition splits it**, can keep serving
(stay **A**vailable) or refuse writes to protect **C**onsistency — not both. That
is CAP. PACELC adds the non-partition case: **E**lse, you still trade **L**atency
against **C**onsistency on every request (a quorum read is slower than a local
one).

- **CP** — a single primary, synchronous replication, or consensus (Raft/Paxos).
  Reads never lie; a partition or a lost leader stalls writes until failover.
- **AP** — asynchronous replicas or multi-leader. Always answers; a partition
  means some answers are stale or conflicting, reconciled later.

In Breakpoint: `single` and async `primary-replica` lean **AP** for reads (the
replica may trail the primary by `replicationLagMs`); `multi-primary` with write
coordination and the distributed-SQL engines lean **CP** (writes pay a
cross-node round-trip); `sharded` is CP *within* a key, with no guarantee
*across* keys.

*Use CP when* a wrong answer is worse than no answer — balances, inventory,
auth. *Use AP when* availability wins and staleness is cosmetic — feeds,
catalogs, counters, recommendations.

---

<a id="replication"></a>

## Replication & read/write split (master–slave)

One **primary** takes writes; **replicas** copy its log and serve reads. This
scales *reads* linearly and gives you a failover target — it does **nothing** for
write throughput.

- **Async** (default): the primary acknowledges before replicas catch up. Fast,
  but a read routed to a replica can be `replicationLagMs` behind, and a
  read-after-write on a replica can miss the write. Breakpoint charges that as a
  latency penalty on replica reads, scaled by the write fraction (read-your-
  writes).
- **Failover**: on primary loss you promote a replica. Expect a brief write
  outage and, with async replication, possible loss of the last few unreplicated
  writes.

*Use it when* reads dominate (≳ 70%) and the workload tolerates second-class
staleness on the read path. Pair it with a cache for the hottest reads.

---

<a id="sharding"></a>

## Sharding & consistent hashing

Partition the keyspace across N independent nodes so **writes** scale. Each shard
is its own little database; a query that needs one key touches one shard, a query
that spans keys **scatter-gathers** across all of them.

- **Shard key** is the whole game. A low-cardinality or skewed key (Zipfian
  access) piles load on one **hot shard** while the rest idle.
- **Consistent hashing** (with virtual nodes) spreads keys evenly and keeps
  re-sharding cheap — only `1/N` of keys move when you add a node, versus
  rehashing everything with `hash(key) % N`.
- **Cross-shard** transactions and joins are expensive and give up the
  single-shard consistency guarantee.

*Use it when* the store is **write-bound** and saturated (replicas can't help),
and there's a natural high-cardinality partition key with few cross-partition
queries. Rebalance a hot shard by salting the key or switching to consistent
hashing.

---

<a id="load-balancing"></a>

## Load-balancing algorithms

- **Round-robin** — next backend in rotation. Cheapest; assumes every request
  costs about the same.
- **Least-connections** — send to the backend with the fewest in-flight
  requests. Absorbs variance when some requests are much heavier than others.
- **Random / power-of-two-choices** — pick two at random, take the less loaded.
  Near-least-conn quality without central connection tracking; scales to huge
  fleets.
- **Hash / sticky** — route by client or key when the backend holds session or
  cache affinity.

*Use least-conn when* request cost varies a lot; *round-robin when* work is
uniform and you want the cheapest thing; *random-of-two when* the fleet is large
enough that tracking state per backend hurts.

---

<a id="proxies"></a>

## Proxies: reverse vs forward

- **Reverse proxy** sits *in front of your servers* and faces the client: TLS
  termination, health checks, response caching, compression, rate-limiting,
  request routing / fan-out, a shield for the origin. A load balancer and a CDN
  are both reverse proxies.
- **Forward proxy** sits *in front of your clients* and faces the internet:
  egress control, outbound caching, corporate policy. Different job, different
  place in the topology.

*Use a reverse proxy* as the front door of any app tier — it is the natural home
for cross-cutting concerns you don't want in application code. A design with no
LB/CDN in front of the app tier is missing that seam.

---

<a id="caching"></a>

## Caching patterns

- **Cache-aside (lazy)** — the app checks the cache, on a miss reads the store
  and populates the cache. Simple, resilient to cache loss; first request per key
  is slow and the cache can briefly serve stale data after a write.
- **Write-through / write-behind** — writes go through the cache to the store
  (or are buffered and flushed). Reads are always warm and fresh; writes are
  slower (or durability is deferred).
- **TTL + jitter** — expire entries with a randomized TTL so they don't all
  fall due at once.
- **Stampede / thundering herd** — when a hot key expires, many requests miss
  simultaneously and hammer the store. Fix with a per-key lock (single-flight),
  early recomputation, or a stale-while-revalidate window.

*Use cache-aside when* reads dominate and short staleness is fine;
*write-through when* reads must reflect the latest write; always add jitter and a
stampede guard on hot keys.

---

<a id="backpressure"></a>

## Queues & backpressure

A queue **decouples** producers from consumers and **absorbs bursts** — it does
not add processing capacity. If the consumer's sustained drain rate is below the
arrival rate, the backlog grows without bound until it hits retention limits and
starts dropping.

Handle it by adding consumers, increasing consumer parallelism (more partitions),
shedding or dead-lettering the overflow, or pushing backpressure upstream so
producers slow down.

*Use a queue when* work can be done asynchronously and arrival is bursty;
*don't* use it to paper over a consumer that is simply too small.

---

<a id="circuit-breakers"></a>

## Circuit breakers & bulkheads

A **circuit breaker** wraps a call to a flaky dependency. It watches the error
rate over a window; once that crosses a threshold it **trips open** and
fast-fails every call for a cooldown, then lets a **half-open** probe through to
test recovery. This does two things: the dependency stops receiving load while
it's down (it gets room to recover), and your callers get a bounded fast-fail
instead of piling up on a timeout.

A **bulkhead** isolates resources (a separate connection pool / thread pool per
dependency) so one slow dependency can't consume every worker and take down
unrelated paths.

*Use a breaker* around any third-party or cross-service call on the request path,
always with a **timeout** on the call itself. *Use bulkheads* when one process
talks to several dependencies of differing reliability.

---

## Datastore engine families

<a id="relational"></a>

### Relational (PostgreSQL, MySQL)

Row storage, rich SQL, ACID transactions, joins. Bound first by the **connection
pool**. Sharding is a bolt-on. Single-node is CP. The default choice until a
specific axis (write volume, scale-out, latency) forces a change.

<a id="document"></a>

### Document (MongoDB)

JSON-ish documents; denormalized data means a read is often one lookup, so reads
are cheaper. Bound by **coordinator throughput**, not a pool. Native sharding,
tunable consistency, **AP** by default. Good for content, catalogs, user
profiles.

<a id="wide-column"></a>

### Wide-column / LSM (Cassandra, ScyllaDB)

Log-structured storage: **writes are cheap appends**, reads pay amplification
(merge across SSTables). Multi-primary with tunable quorum, linear scale with
nodes, **AP**. Built for write-heavy, time-series, and always-on workloads.

<a id="managed-kv"></a>

### Managed key-value (DynamoDB)

Provisioned or on-demand **capacity units** are the ceiling; latency is
predictable if you stay under them. Native partitioning, but a **hot partition**
still bites. Strongly-consistent reads cost more than eventually-consistent ones.

<a id="in-memory-kv"></a>

### In-memory key-value (Redis as a store)

Sub-millisecond ops, **throughput-bound**. Durability is a trade-off (snapshot /
AOF), so as a *primary* store it fits data you can afford to lose or rebuild.
Distinct from using Redis as a cache in front of another store.

<a id="distributed-sql"></a>

### Distributed SQL (CockroachDB, Spanner, Vitess)

Keeps SQL and serializable transactions while scaling horizontally. Every write
carries a **consensus round-trip** (a fixed latency add), so it is **CP** and
write-latency-sensitive, but you stop hand-rolling sharding.

<a id="time-series"></a>

### Time-series (Prometheus, InfluxDB, TimescaleDB)

Append-only metrics / events keyed by time. Writes are **almost free** — batched
appends to a log-structured or column-chunked store. The cost moves to the read
side: range queries and downsampling scan many series. **Throughput-bound**
(ingest points/sec), not pool-bound; scales by federation / sharding on the
series key. Retention + rollups keep the working set bounded. Use it for metrics,
IoT, event analytics — not for anything you need to update in place.

---

## References

Same as [`model.md`](model.md) — Kleinrock; Harchol-Balter; Gross et al. Plus
Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017, for the
storage-engine and replication material.
