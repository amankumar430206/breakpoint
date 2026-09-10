import type { ConceptDoc } from './types';

/**
 * Cross-cutting system-design patterns. These are the ideas the Design-review
 * advisor points at, plus the recurring gaps that trip people up. Prose is
 * original; sources are under `further`.
 */
export const CONCEPT_DOCS: Record<string, ConceptDoc> = {
  cap: {
    slug: 'cap',
    title: 'CAP & PACELC',
    cluster: 'data',
    body: `When a network partition splits a distributed store, it can keep serving (stay **available**) or refuse writes to protect **consistency** — not both. That is CAP.

PACELC adds the normal case: **else**, with no partition, you still trade **latency** against **consistency** on every request — a quorum read that crosses nodes is slower than a local one.

**CP** — a single primary, synchronous replication, or consensus (Raft/Paxos). Reads never lie; a partition or a lost leader stalls writes until failover. **AP** — asynchronous replicas or multi-leader. Always answers; a partition means some answers are stale or conflicting, reconciled later.

In Breakpoint, \`single\` and async \`primary-replica\` lean AP for reads (a replica trails the primary by \`replicationLagMs\`); \`multi-primary\` and the distributed-SQL engines lean CP (writes pay a cross-node round-trip); \`sharded\` is CP within a key, with no guarantee across keys.`,
    useWhen: `Choose CP when a wrong answer is worse than no answer — balances, inventory, auth. Choose AP when availability wins and staleness is cosmetic — feeds, catalogs, counters, recommendations.`,
    relatedComponents: ['sqlDatabase', 'coordination', 'cache'],
    further: [
      { label: 'Kleppmann — Designing Data-Intensive Applications, ch. 9', url: 'https://dataintensive.net/' },
      { label: 'Abadi — Consistency Tradeoffs (PACELC)', url: 'https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf' },
    ],
  },

  replication: {
    slug: 'replication',
    title: 'Replication & read/write split',
    cluster: 'data',
    body: `One **primary** takes writes; **replicas** copy its log and serve reads. This scales *reads* linearly and gives you a failover target — it does nothing for write throughput.

**Async** (the default): the primary acknowledges before replicas catch up. Fast, but a read routed to a replica can be \`replicationLagMs\` behind, and a read-after-write on a replica can miss the write entirely.

**Failover**: on primary loss you promote a replica. Expect a brief write outage and, with async replication, possible loss of the last few unreplicated writes (RPO > 0).

A read/write router has to know which reads *can't* tolerate lag and pin those to the primary.`,
    useWhen: `Use it when reads dominate (≳ 70%) and the read path tolerates second-class staleness. Pair it with a cache for the hottest reads and a router that keeps read-your-writes flows on the primary.`,
    relatedComponents: ['sqlDatabase', 'dbProxy', 'cache'],
    further: [
      { label: 'Kleppmann — DDIA ch. 5, Replication', url: 'https://dataintensive.net/' },
      { label: 'Google Cloud SQL — Replication lag', url: 'https://cloud.google.com/sql/docs/postgres/replication/replication-lag' },
    ],
  },

  sharding: {
    slug: 'sharding',
    title: 'Sharding & consistent hashing',
    cluster: 'data',
    body: `Partition the keyspace across N independent nodes so **writes** scale. Each shard is its own little database; a single-key query touches one shard, a cross-key query **scatter-gathers** across all of them.

The **shard key** is the whole game. A low-cardinality or skewed key (Zipfian access) piles load on one **hot shard** while the rest idle.

**Consistent hashing** with virtual nodes spreads keys evenly and keeps re-sharding cheap — only \`1/N\` of keys move when you add a node, versus rehashing everything with \`hash(key) % N\`.

Cross-shard transactions and joins are expensive and give up the single-shard consistency guarantee.`,
    useWhen: `Use it only when the store is write-bound and saturated (replicas can't help), and there's a natural high-cardinality partition key with few cross-partition queries. Exhaust vertical scaling + replicas + cache first.`,
    relatedComponents: ['sqlDatabase', 'searchIndex', 'analyticsDb'],
    further: [
      { label: 'Kleppmann — DDIA ch. 6, Partitioning', url: 'https://dataintensive.net/' },
      { label: 'system-design-primer — Database', url: 'https://github.com/donnemartin/system-design-primer#database' },
    ],
  },

  'load-balancing': {
    slug: 'load-balancing',
    title: 'Load-balancing algorithms',
    cluster: 'edge',
    body: `**Round robin** — next backend in rotation. Cheapest; assumes every request costs about the same.

**Least connections** — send to the backend with the fewest in-flight requests. Absorbs variance when some requests are much heavier than others.

**Power of two choices** — pick two backends at random, take the less loaded. Near-least-connections quality without central connection tracking; scales to huge fleets.

**Hash / sticky** — route by client or key when the backend holds session or cache affinity. Only \`1/N\` of keys move on a scale event if you use consistent hashing.

L4 balancers act at the connection level (fast, protocol-agnostic); L7 balancers read HTTP and can route on path/header, terminate TLS, and shed abusive traffic.`,
    useWhen: `Least connections when request cost varies a lot; round robin when work is uniform and you want the cheapest thing; power-of-two when the fleet is large enough that per-backend state tracking hurts.`,
    relatedComponents: ['loadBalancer', 'apiServer', 'dns'],
    further: [
      { label: 'Google SRE Book — Load Balancing at the Frontend', url: 'https://sre.google/sre-book/load-balancing-frontend/' },
      { label: 'system-design-primer — Load balancer', url: 'https://github.com/donnemartin/system-design-primer#load-balancer' },
    ],
  },

  proxies: {
    slug: 'proxies',
    title: 'Proxies: reverse vs forward',
    cluster: 'edge',
    body: `A **reverse proxy** sits *in front of your servers* and faces the client: TLS termination, health checks, response caching, compression, rate limiting, request routing and fan-out — a shield for the origin. A load balancer, a CDN, and an API gateway are all reverse proxies.

A **forward proxy** sits *in front of your clients* and faces the internet: egress control, outbound caching, corporate policy. Different job, different place in the topology.

A design with no LB / CDN / gateway in front of the app tier is missing the seam where cross-cutting concerns belong.`,
    useWhen: `Put a reverse proxy at the front door of any app tier — it is the natural home for the concerns you don't want duplicated in application code.`,
    relatedComponents: ['loadBalancer', 'cdn', 'apiGateway', 'dns'],
    further: [
      { label: 'system-design-primer — Reverse proxy', url: 'https://github.com/donnemartin/system-design-primer#reverse-proxy-web-server' },
      { label: 'NGINX — What is a reverse proxy?', url: 'https://www.nginx.com/resources/glossary/reverse-proxy-server/' },
    ],
  },

  caching: {
    slug: 'caching',
    title: 'Caching patterns',
    cluster: 'data',
    body: `**Cache-aside (lazy)** — the app checks the cache, and on a miss reads the store and populates the cache. Simple, resilient to cache loss; the first request per key is slow and the cache can briefly serve stale data after a write.

**Write-through / write-behind** — writes go through the cache to the store (or are buffered and flushed later). Reads stay warm and fresh; writes are slower, or durability is deferred.

**TTL + jitter** — expire entries with a randomized TTL so a whole class of keys doesn't fall due at the same instant.

**Stampede / thundering herd** — when a hot key expires, many requests miss simultaneously and hammer the store. Fix with a per-key lock (single-flight), probabilistic early recomputation, or a stale-while-revalidate window.

**Penetration** — requests for keys that don't exist always miss and always hit the store. Cache the negative result or gate with a Bloom filter.`,
    useWhen: `Cache-aside when reads dominate and short staleness is fine; write-through when reads must reflect the latest write. Always add TTL jitter and a stampede guard on hot keys, and measure the hit ratio — a low-hit cache is pure overhead and risk.`,
    relatedComponents: ['cache', 'sqlDatabase', 'cdcConnector'],
    further: [
      { label: 'Redis — Cache stampede prevention', url: 'https://redis.antirez.com/fundamental/cache-stampede-prevention.html' },
      { label: 'Facebook — Scaling Memcache at Facebook', url: 'https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf' },
    ],
  },

  backpressure: {
    slug: 'backpressure',
    title: 'Queues & backpressure',
    cluster: 'messaging',
    body: `A queue **decouples** producers from consumers and **absorbs bursts** — it does not add processing capacity. If the consumer's sustained drain rate is below the arrival rate, the backlog grows without bound until it hits a retention limit and starts dropping.

Handle it by adding consumers, raising consumer parallelism (more partitions), shedding or dead-lettering the overflow, or pushing **backpressure** upstream so producers slow down.

Treating a broker as an infinite buffer is the classic mistake — the buffer just moves the failure from "dropped now" to "hours of lag later." Autoscale consumers on **queue depth / consumer lag**, not CPU.`,
    useWhen: `Use a queue when work can be done asynchronously and arrival is bursty. Don't use it to paper over a consumer that is simply too small — measure recovery time as backlog ÷ drain rate.`,
    relatedComponents: ['queue', 'pubsubTopic', 'worker', 'streamProcessor'],
    further: [
      { label: 'Enterprise Integration Patterns — Competing Consumers', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html' },
      { label: 'Kleppmann — DDIA ch. 11, Stream Processing', url: 'https://dataintensive.net/' },
    ],
  },

  'circuit-breakers': {
    slug: 'circuit-breakers',
    title: 'Circuit breakers & bulkheads',
    cluster: 'resilience',
    body: `A **circuit breaker** wraps a call to a flaky dependency. It watches the error and slow-call rate over a window; once that crosses a threshold it **trips open** and fast-fails every call for a cooldown, then lets a **half-open** probe through to test recovery.

This does two things: the sick dependency stops receiving load (room to recover), and callers get a bounded fast-fail instead of piling up on timeouts.

A **bulkhead** isolates resources — a separate connection or thread pool per dependency — so one slow dependency can't consume every worker and take down unrelated paths.

A breaker with no **timeout** on the underlying call is nearly useless; a breaker with no **fallback** just converts slow errors into fast errors.`,
    useWhen: `Put a breaker around any third-party or cross-service call on the request path, always with a timeout, and give the open state a fallback (cached value, default, "try later"). Use bulkheads when one process talks to several dependencies of differing reliability.`,
    relatedComponents: ['circuitBreaker', 'externalService', 'apiServer'],
    further: [
      { label: 'Martin Fowler — CircuitBreaker', url: 'https://martinfowler.com/bliki/CircuitBreaker.html' },
      { label: 'AWS Builders’ Library — Timeouts, retries and backoff with jitter', url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/' },
    ],
  },

  idempotency: {
    slug: 'idempotency',
    title: 'Idempotency',
    cluster: 'resilience',
    body: `A network can drop the *response* to a request that actually succeeded, so the caller retries and the work runs twice. At-least-once delivery in any queue or broker guarantees this happens.

An operation is **idempotent** if doing it twice has the same effect as doing it once. GET, PUT and DELETE are naturally idempotent; POST (create, charge, send) is not.

Make it safe with an **idempotency key** the client generates once per logical action, plus a store of processed keys the server checks before acting. On a repeat key it returns the original result instead of redoing the work.

True *exactly-once delivery* is impossible over an unreliable link. "Effectively once" = at-least-once delivery + idempotent consumers.`,
    useWhen: `Required on every non-idempotent operation reachable through a retry, a queue, or a webhook — payments, order creation, outbound notifications, any state mutation a client or broker can resend.`,
    relatedComponents: ['queue', 'pubsubTopic', 'apiServer', 'notificationService', 'worker'],
    further: [
      { label: 'Stripe — Idempotent requests', url: 'https://docs.stripe.com/api/idempotent_requests' },
      { label: 'Enterprise Integration Patterns — Idempotent Receiver', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html' },
    ],
  },

  retries: {
    slug: 'retries',
    title: 'Retries, backoff & jitter',
    cluster: 'resilience',
    body: `Retrying a failed call helps only for **transient** errors (a blip, a brief timeout). Retrying a persistent failure just multiplies load on something already on fire — "a retry is a selfish act."

**Exponential backoff** spaces attempts out (1s, 2s, 4s…). **Jitter** randomizes each delay so a thousand clients that failed together don't all retry in the same instant and create a recovery-time thundering herd.

Cap the attempts (2–3), keep a **retry budget** so retries stay a small fraction of total traffic, and never retry through a layer that is itself retrying — the multiplication compounds.`,
    useWhen: `On transient, safe-to-repeat failures only, always with capped exponential backoff + jitter, paired with a circuit breaker for the sustained-failure case and idempotency so a duplicate is harmless.`,
    relatedComponents: ['circuitBreaker', 'externalService', 'queue', 'apiGateway'],
    further: [
      { label: 'AWS Builders’ Library — Timeouts, retries and backoff with jitter', url: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/' },
      { label: 'AWS Architecture Blog — Exponential Backoff And Jitter', url: 'https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/' },
    ],
  },

  'golden-signals': {
    slug: 'golden-signals',
    title: 'The four golden signals',
    cluster: 'resilience',
    body: `Google SRE reduces "what do I monitor?" to four signals per component:

**Latency** — how long a request takes. Track a percentile (p99), and split successful from failed requests: a fast error is still an error.

**Traffic** — demand on the component: requests/s, connections, messages/s.

**Errors** — the rate of failed requests, including "succeeded but wrong" and requests that blew a latency SLO.

**Saturation** — how full the most constrained resource is (CPU, memory, pool slots, queue depth). The metric that predicts the outage before latency and errors move.

Instantiate all four for every box on the diagram. If you can't name them for a component, you don't understand its failure mode yet.`,
    useWhen: `Every component, always. They are the spine of a dashboard and the first thing to check in an incident.`,
    relatedComponents: ['apiServer', 'loadBalancer', 'sqlDatabase', 'queue'],
    further: [
      { label: 'Google SRE Book — Monitoring Distributed Systems', url: 'https://sre.google/sre-book/monitoring-distributed-systems/' },
    ],
  },

  'delivery-semantics': {
    slug: 'delivery-semantics',
    title: 'Delivery semantics & ordering',
    cluster: 'messaging',
    body: `**At-most-once** — fire and forget. Simple, lossy: a crash between send and process drops the message.

**At-least-once** — the broker redelivers until the consumer acks. Nothing is lost, but duplicates and reordering are normal — every consumer needs to be idempotent.

**Exactly-once** — impossible as a *delivery* guarantee over an unreliable network. Systems approximate it as at-least-once + a dedup store ("effectively once").

**Ordering** is usually per-partition / per-key, not global. Adding competing consumers to a queue trades ordering for throughput. A **dead-letter queue** catches messages that fail N times so one poison payload doesn't wedge the pipeline — and it needs an alert on its arrival rate, or it's just where bugs hide.`,
    useWhen: `Default to at-least-once + idempotent consumers + a DLQ. Reach for strict ordering only where the domain truly needs it, and pay for it with reduced parallelism.`,
    relatedComponents: ['queue', 'pubsubTopic', 'streamProcessor', 'cdcConnector'],
    further: [
      { label: 'Kleppmann — DDIA ch. 11', url: 'https://dataintensive.net/' },
      { label: 'Enterprise Integration Patterns — Dead Letter Channel', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/DeadLetterChannel.html' },
    ],
  },

  'cascading-failure': {
    slug: 'cascading-failure',
    title: 'Cascading failure',
    cluster: 'resilience',
    body: `One component slows down. Callers hold threads and connections waiting on it, so *they* slow down and run out of capacity. Their callers do the same. A local problem becomes a total outage in seconds.

Retries without backoff pour fuel on it. A load balancer with an over-eager health check ejects a struggling node and dumps its traffic on the survivors, tipping them over too.

Contain it with **timeouts** (bound every wait), **circuit breakers** (stop calling the sick thing), **bulkheads** (cap the blast radius), **load shedding** (drop excess work at the door instead of collapsing), and **graceful degradation** (serve a cached or reduced response).`,
    useWhen: `Assume it will happen. Any request-path call to a dependency that can fail independently needs a timeout and a breaker; ingress needs a way to shed load.`,
    relatedComponents: ['circuitBreaker', 'loadBalancer', 'apiGateway', 'apiServer'],
    further: [
      { label: 'Google SRE Book — Addressing Cascading Failures', url: 'https://sre.google/sre-book/addressing-cascading-failures/' },
      { label: 'Nygard — Release It! (stability patterns)', url: 'https://pragprog.com/titles/mnee2/release-it-second-edition/' },
    ],
  },

  // ---- datastore engine families ---------------------------------------
  relational: {
    slug: 'relational',
    title: 'Relational engines (PostgreSQL, MySQL)',
    cluster: 'data',
    body: `Row storage, rich SQL, ACID transactions, joins, constraints. Bound first by the **connection pool** — each connection is a backend process/thread with real memory, and \`max_connections\` sits in the low hundreds.

A single well-tuned primary handles thousands to tens of thousands of TPS and low-TB data. Sharding is a bolt-on, not a native capability. Single-node is CP.

The default system-of-record choice until a specific axis — write volume, horizontal scale, global latency — provably forces a change.`,
    useWhen: `Anything needing transactions, joins, or referential integrity: money, inventory, identity, orders. Front it with a connection pooler and a cache before reaching for anything more exotic.`,
    relatedComponents: ['sqlDatabase', 'dbProxy', 'cache'],
    further: [{ label: 'system-design-primer — SQL or NoSQL', url: 'https://github.com/donnemartin/system-design-primer#sql-or-nosql' }],
  },

  document: {
    slug: 'document',
    title: 'Document stores (MongoDB)',
    cluster: 'data',
    body: `JSON-ish documents. Denormalized data means a read is often a single lookup, so reads are cheap. Bound by **coordinator throughput**, not a connection pool.

Native sharding, tunable consistency, AP by default. Good for content, catalogs, user profiles — data that is read as a whole object and rarely joined.`,
    useWhen: `Read-mostly, object-shaped data with a flexible schema and few cross-document transactions. Not a fit when you need multi-key ACID or ad-hoc analytical joins.`,
    relatedComponents: ['sqlDatabase', 'cache'],
    further: [{ label: 'MongoDB — Data modeling', url: 'https://www.mongodb.com/docs/manual/core/data-modeling-introduction/' }],
  },

  'wide-column': {
    slug: 'wide-column',
    title: 'Wide-column / LSM (Cassandra, ScyllaDB)',
    cluster: 'data',
    body: `Log-structured storage: **writes are cheap appends**; reads pay amplification, merging across SSTables. Multi-primary with tunable quorum, linear scale as you add nodes, AP.

Built for write-heavy, time-series, and always-on workloads where you query by a known partition key and never join.`,
    useWhen: `Sustained high write volume with key-based access and no cross-partition queries. Model the table around the query, not the entities.`,
    relatedComponents: ['sqlDatabase', 'streamProcessor'],
    further: [{ label: 'Kleppmann — DDIA ch. 3 (LSM-trees)', url: 'https://dataintensive.net/' }],
  },

  'managed-kv': {
    slug: 'managed-kv',
    title: 'Managed key-value (DynamoDB)',
    cluster: 'data',
    body: `Provisioned or on-demand **capacity units** are the ceiling; latency is predictable as long as you stay under them. Native partitioning, but a **hot partition** still bites.

Strongly-consistent reads cost about twice an eventually-consistent read. Access is by key or by a carefully designed secondary index — no ad-hoc queries.`,
    useWhen: `Predictable key-value access at scale where you want zero operational overhead and can design every access pattern up front. Not for flexible querying or analytics.`,
    relatedComponents: ['sqlDatabase', 'cache'],
    further: [{ label: 'AWS — DynamoDB best practices', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html' }],
  },

  'in-memory-kv': {
    slug: 'in-memory-kv',
    title: 'In-memory key-value (Redis as a store)',
    cluster: 'data',
    body: `Sub-millisecond operations, **throughput-bound**. Durability is a trade-off — snapshotting or an append-only file — so as a *primary* store it fits data you can afford to lose or rebuild.

Distinct from using Redis as a cache in front of another store: here it *is* the system of record for that data (sessions, rate-limit counters, leaderboards, ephemeral state).`,
    useWhen: `Small, hot, latency-critical datasets that tolerate a bounded loss window. Shard or add replicas past a single node's throughput.`,
    relatedComponents: ['cache', 'sqlDatabase'],
    further: [{ label: 'Redis — Persistence', url: 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/' }],
  },

  'distributed-sql': {
    slug: 'distributed-sql',
    title: 'Distributed SQL (CockroachDB, Spanner, Vitess)',
    cluster: 'data',
    body: `Keeps SQL and serializable transactions while scaling horizontally. Every write carries a **consensus round-trip** — a fixed latency add — so it is CP and write-latency-sensitive.

The trade you're making: you stop hand-rolling sharding and cross-shard coordination, and you pay for it in per-write latency and operational complexity.`,
    useWhen: `You've outgrown a single primary + replicas, need SQL semantics and strong consistency, and can absorb tens of milliseconds of extra write latency.`,
    relatedComponents: ['sqlDatabase', 'coordination'],
    further: [{ label: 'Google — Spanner paper', url: 'https://research.google/pubs/pub39966/' }],
  },

  'time-series': {
    slug: 'time-series',
    title: 'Time-series stores (Prometheus, InfluxDB, TimescaleDB)',
    cluster: 'data',
    body: `Append-only metrics and events keyed by time. Writes are **almost free** — batched appends to a log-structured or column-chunked store. The cost moves to the read side: range queries and downsampling scan many series.

**Throughput-bound** on ingest points/sec, not pool-bound. Scales by federation or sharding on the series key. Retention windows and rollups keep the working set bounded.`,
    useWhen: `Metrics, IoT, event analytics — data you append and query by time range, never update in place. Not a general-purpose store.`,
    relatedComponents: ['analyticsDb', 'streamProcessor', 'sqlDatabase'],
    further: [{ label: 'Prometheus — Storage', url: 'https://prometheus.io/docs/prometheus/latest/storage/' }],
  },
};

export function getConceptDoc(slug: string): ConceptDoc | undefined {
  return CONCEPT_DOCS[slug];
}
