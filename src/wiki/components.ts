import type { ComponentType } from '@/engine';
import type { ComponentDoc } from './types';

/**
 * One explainer per component type. Field order is the learning arc defined in
 * `types.ts`. Prose is original synthesis; `further` carries the citations.
 */
export const COMPONENT_DOCS: Record<ComponentType, ComponentDoc> = {
  // ==== EDGE & TRAFFIC ===================================================
  client: {
    type: 'client',
    cluster: 'edge',
    tagline: 'The traffic source — browsers, mobile apps, or other services generating the requests your system must absorb.',
    problem: `Every capacity question starts with "how much load, shaped how?" The client node is where you state that: a request rate, or a closed-loop population of users who send, wait for a reply, think, and send again. The two framings behave very differently under saturation.`,
    mechanism: `Open loop (rps): a fixed arrival rate regardless of how the system responds — load keeps coming even as latency climbs. Closed loop (users): N users each in a send → wait → think cycle, so the effective rate self-limits as responses slow (Little's law, λ = N / (R + Z)). Scenario shapes layer on top: constant, wander, ramp, diurnal, spike, thundering herd.`,
    whenToUse: `Use rps mode to model a public endpoint or an upstream service that won't slow down for you. Use users mode for interactive traffic where a slow system naturally produces fewer requests. The closed-loop model is more honest for most product workloads.`,
    failure: `Not a failure point itself — but the shape you pick decides what failure you see downstream. An open-loop spike drives unbounded queue growth and drop; the same nominal load in closed-loop mode plateaus because users can't outpace their own responses.`,
    metrics: [
      'Offered rate — requests/s entering the system',
      'Served rate — requests/s completing successfully',
      'Success rate — served ÷ offered',
      'End-to-end p99 latency along the slowest path',
    ],
    capacity: `A single browser tab issues maybe 6 concurrent HTTP/1.1 connections per origin; a load generator, far more. "Users" and "requests/s" are related by think time: 10k users with a 3s think time ≈ 3.3k rps.`,
    pairedWith: [
      { type: 'dns', why: 'the client’s first hop — resolves the name and (with a traffic manager) picks a healthy region' },
      { type: 'cdn', why: 'serves static and cacheable responses without the request ever reaching your origin' },
      { type: 'loadBalancer', why: 'the entry point that spreads client traffic across your stateless tier' },
    ],
    mistakes: [
      'Testing only with a constant scenario — real traffic has diurnal peaks and spikes that expose different bottlenecks',
      'Using rps mode for interactive traffic, which overstates load because real users would back off as the system slows',
      'Ignoring that clients retry — a struggling system sees *more* load, not less',
    ],
    concepts: ['golden-signals'],
    further: [
      { label: 'Little’s Law — a primer', url: 'https://en.wikipedia.org/wiki/Little%27s_law' },
      { label: 'ByteByteGo — Back-of-the-envelope estimation', url: 'https://blog.bytebytego.com/p/a-crash-course-in-caching-final-part' },
    ],
  },

  dns: {
    type: 'dns',
    cluster: 'edge',
    tagline: 'Turns a hostname into an address, and — as a global traffic manager — steers each client toward a healthy, nearby endpoint.',
    problem: `Clients need to find your system before anything else happens, and a single-region entry point is a single point of failure. DNS is the earliest place to route around a dead region — but its answers are cached by resolvers, so changes propagate slowly.`,
    mechanism: `A resolver walks the DNS hierarchy and caches the answer for the record's TTL. A traffic-managing DNS (Route 53, Cloudflare, Akamai GTM) returns *different* answers by policy: simple (one record), geo (nearest region), latency (fastest measured), weighted (canary / A-B), or failover (health-checked — drop a region when its checks fail). Anycast pushes the same idea into the network layer with no TTL wait.`,
    whenToUse: `Always the first hop. Use a failover or latency policy the moment you run more than one region — "simple" means a region outage is a full outage. The alternative for fast failover is anycast + BGP, which trades DNS-level control for network complexity.`,
    failure: `Effectively uncapped in throughput, so it is rarely the bottleneck — but a high TTL delays failover (clients keep the dead address cached), and a misconfigured record or an expired domain is a total, self-inflicted outage. Health-check flapping bounces traffic between regions.`,
    metrics: [
      'Resolution latency (usually ~0 with client caching)',
      'Query rate',
      'Health-check pass/fail per endpoint',
      'Failover events and time-to-detect',
    ],
    capacity: `Managed DNS scales to millions of queries/s. TTLs of 30–60s are a common failover/caching compromise; a 24h TTL means a full day to move traffic.`,
    pairedWith: [
      { type: 'loadBalancer', why: 'DNS picks the region; the load balancer picks the instance within it' },
      { type: 'cdn', why: 'often the DNS target — the CDN edge is what the resolved name actually points at' },
    ],
    mistakes: [
      'A "simple" routing policy with multiple regions — no automatic failover, so a regional outage is total',
      'TTLs so long that failover takes hours',
      'Treating DNS as static config and never health-checking the endpoints it hands out',
    ],
    concepts: ['proxies', 'load-balancing'],
    further: [
      { label: 'AWS — Route 53 routing policies', url: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html' },
      { label: 'Cloudflare — What is anycast?', url: 'https://www.cloudflare.com/learning/cdn/glossary/anycast-network/' },
    ],
  },

  cdn: {
    type: 'cdn',
    cluster: 'edge',
    tagline: 'A globally distributed cache of reverse proxies that serves cacheable responses from an edge near the user, so most requests never touch your origin.',
    problem: `Static assets and cacheable pages don't need your origin's compute or its geography — but serving them from one region is slow for distant users and wastes origin capacity. A CDN trades a little staleness and cache-invalidation effort for large latency and offload wins.`,
    mechanism: `Requests hit the nearest **edge**. On a hit, the edge answers directly. On a miss, it fetches from origin (or a mid-tier shield), caches per the \`Cache-Control\` / TTL, and answers. Offload = hit ratio; only the miss fraction becomes origin load. Invalidation is by TTL, explicit purge, or cache-key versioning. Modern CDNs also run compute at the edge (redirects, auth, personalization).`,
    whenToUse: `Anything static, large, or read-mostly with a global audience: images, video segments, JS/CSS bundles, API GET responses with a tolerable TTL. The alternative — a plain cache in one region — cuts origin load but not distance latency.`,
    failure: `A cold cache after a purge or a new deploy sends a miss storm to the origin — size the origin for the miss rate, not the edge rate. A too-short TTL collapses the hit ratio; a too-long one serves stale content. The CDN itself is a dependency: an edge outage or a bad purge is user-visible.`,
    metrics: [
      'Edge latency and origin-fetch latency',
      'Cache hit ratio (offload %)',
      'Origin request rate (the miss fraction)',
      'Edge + origin error rates, bytes served',
    ],
    capacity: `Well-cached sites see 85–99% offload; the origin only needs to handle the misses plus cache-fill. Edge capacity is effectively unlimited for cacheable content; dynamic pass-through is not.`,
    pairedWith: [
      { type: 'objectStore', why: 'the durable origin for media — the CDN caches what the object store holds' },
      { type: 'loadBalancer', why: 'fronts the dynamic origin that cache misses fall through to' },
      { type: 'apiServer', why: 'the origin for cacheable API responses; only misses cost app capacity' },
    ],
    mistakes: [
      'Sizing the origin for edge traffic instead of the miss rate — a purge then melts it',
      'No TTL jitter, so a class of objects expires together and stampedes the origin',
      'Caching responses that vary per user without a correct Vary / cache key — users see each other’s data',
    ],
    concepts: ['caching', 'proxies'],
    further: [
      { label: 'Cloudflare — What is a CDN?', url: 'https://www.cloudflare.com/learning/cdn/what-is-a-cdn/' },
      { label: 'MDN — HTTP caching', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching' },
    ],
  },

  loadBalancer: {
    type: 'loadBalancer',
    cluster: 'edge',
    tagline: 'A traffic director that spreads requests across a pool of interchangeable backends and drops unhealthy ones from rotation.',
    problem: `One server can't hold all the traffic and is a single point of failure. You want horizontal scale and redundancy — but the balancer itself must not become the new SPOF, and spreading traffic evenly conflicts with keeping per-client state on one backend.`,
    mechanism: `**L4** balances at the connection level (fast, protocol-agnostic); **L7** reads HTTP and can route on path/header, terminate TLS, and shed abuse. Algorithms: round robin, least connections (for variable request cost), power-of-two-choices (least-conn quality at fleet scale), consistent hashing (affinity, only 1/N churn on scale events). **Health checks** — active probes for fast detection plus passive observation of real traffic for accuracy. Sticky sessions trade even distribution and failover for local state (usually the wrong trade).`,
    whenToUse: `Front any multi-instance stateless tier. Alternatives: client-side load balancing (no extra hop, but every client needs the pool list and logic) and a service-mesh sidecar (per-pod L7 for east-west traffic). DNS round-robin is the poor version — no health awareness, TTL-delayed failover.`,
    failure: `Saturation on TLS handshakes, connection-tracking table, or ephemeral ports. All-backends-unhealthy → it returns 502/503. Flapping health checks eject healthy nodes and overload the rest. Uneven hashing creates a hot backend. Client retries amplify an already-overloaded pool into a cascade.`,
    metrics: [
      'Added latency (LB) vs backend latency',
      'Request rate; new connections/s; active connections',
      'Error rate split — LB-origin 5xx vs backend-origin',
      'Healthy-host count; per-backend distribution skew; rejected/surge-queued connections',
    ],
    capacity: `A managed LB VIP scales to millions of concurrent connections and tens of Gbps — but it *ramps*; a sudden 100× spike needs pre-warming or an over-provisioned baseline. Not infinite, not instant.`,
    pairedWith: [
      { type: 'apiServer', why: 'the stateless pool it fronts — the LB is what lets you add and remove instances freely' },
      { type: 'dns', why: 'a global traffic manager spreads across regions and routes around a dead LB; the LB handles one' },
      { type: 'cache', why: 'a shared session store lets servers stay stateless, so the LB can use any algorithm instead of sticky sessions' },
      { type: 'apiGateway', why: 'sheds abusive or unauthenticated load before it reaches the balanced pool' },
    ],
    mistakes: [
      'Treating the LB as infinite and instant — no pre-warm for spikes, no thought for it being a SPOF',
      'Sticky sessions as a substitute for externalized state',
      'Health checks that only ping `/` (miss a broken dependency) or that check every downstream (one outage ejects the whole fleet)',
      'Forgetting that clients retry, multiplying load on an already-hot pool',
    ],
    concepts: ['load-balancing', 'proxies', 'cascading-failure'],
    further: [
      { label: 'Google SRE Book — Load Balancing at the Frontend', url: 'https://sre.google/sre-book/load-balancing-frontend/' },
      { label: 'system-design-primer — Load balancer', url: 'https://github.com/donnemartin/system-design-primer#load-balancer' },
      { label: 'AWS — ELB / ALB / NLB', url: 'https://docs.aws.amazon.com/elasticloadbalancing/' },
    ],
  },

  apiGateway: {
    type: 'apiGateway',
    cluster: 'edge',
    tagline: 'A single entry point for external clients that routes each request to the right service and enforces cross-cutting concerns — auth, rate limiting, quotas — so services don’t each reimplement them.',
    problem: `Microservices multiply endpoints, auth implementations, and client round-trips. You want one place for policy and a stable public contract — but centralizing risks a chokepoint, a deploy bottleneck, and a "distributed monolith" if business logic leaks in.`,
    mechanism: `A reverse proxy plus a policy engine: request routing, protocol translation (HTTP↔gRPC), token validation and claim injection, rate limiting and quotas, request/response transformation, response aggregation, TLS termination, correlation-ID minting. Variants: thin gateway (route + protect only) vs aggregating gateway; **Backend-for-Frontend** — one gateway per client type to kill over-fetching; managed (AWS API Gateway, Apigee, Kong) vs self-hosted (Envoy, NGINX).`,
    whenToUse: `When more than a handful of services sit behind a public API, or you need centralized auth and rate limiting. Alternatives: direct client-to-service (fine for 1–2 services); a service mesh — complementary, not a substitute: gateway = north-south (external → in), mesh = east-west (service → service). A plain load balancer if you only need distribution without policy.`,
    failure: `A SPOF unless itself multi-AZ. Adds a latency hop, worse with heavy transforms or aggregation. A slow downstream in an aggregation call blocks the whole response without per-call timeouts. Global rate-limiter state contention. The "smart gateway" anti-pattern: business logic accretes, every team's feature is blocked on the gateway deploy, and nobody owns it.`,
    metrics: [
      'Gateway overhead latency vs total latency',
      'Request rate per route and per consumer',
      '4xx breakdown (401 / 403 / 429) and 5xx rate',
      'Rate-limit rejections; auth-validation latency and failure rate; upstream healthy count',
    ],
    capacity: `Managed gateways often cap per-account throughput (thousands of rps by default, raise via quota), payload size (~10 MB), and request duration (~30s) — long uploads or streaming may need to bypass it.`,
    pairedWith: [
      { type: 'identityProvider', why: 'the gateway validates tokens; the IdP issues and rotates the keys and owns the user store — auth once at the edge, services trust injected claims' },
      { type: 'apiServer', why: 'the services it routes to; the gateway gives them a stable contract and offloads auth/limits' },
      { type: 'circuitBreaker', why: 'per-upstream breakers + timeouts keep one dead service from hanging every gateway worker' },
    ],
    mistakes: [
      'Putting business logic in the gateway — it becomes a distributed monolith owned by nobody',
      'No per-upstream timeout on aggregation calls',
      'Running a single instance (no HA) for something on every request path',
      'Building both a gateway and a service mesh to do the same job, or one generic gateway when clients need BFFs',
    ],
    concepts: ['proxies', 'retries', 'cascading-failure'],
    further: [
      { label: 'microservices.io — API Gateway pattern', url: 'https://microservices.io/patterns/apigateway.html' },
      { label: 'microservices.io — Backends for Frontends', url: 'https://microservices.io/patterns/apigateway.html' },
      { label: 'AWS — API Gateway docs', url: 'https://docs.aws.amazon.com/apigateway/' },
    ],
  },

  // ==== COMPUTE =========================================================
  apiServer: {
    type: 'apiServer',
    cluster: 'compute',
    tagline: 'A stateless application tier that runs request handlers — the box that turns an HTTP call into database queries and a response.',
    problem: `Business logic has to run somewhere, and that somewhere must scale horizontally, survive instance loss, and not become the bottleneck. Keeping it stateless is what makes all of that possible; any local state breaks the model.`,
    mechanism: `Each instance runs a bounded number of concurrent requests — roughly \`vCPU × threads-per-core\`, capped by \`RAM ÷ per-request memory\`. Requests beyond that queue (bounded, with load shedding) or are rejected. Service time is CPU work plus any synchronous downstream calls (each DB query, each external call adds directly). Scale out by adding replicas behind a load balancer; autoscale on utilization.`,
    whenToUse: `The default home for request/response logic. Alternatives: serverless functions (no capacity planning, but cold starts and a hard concurrency ceiling) for spiky or low-volume work; a worker pool for anything that doesn't need an immediate response.`,
    failure: `As arrival approaches capacity, queue depth and latency climb non-linearly (the M/M/c wall at ρ→1). Past the queue limit it sheds load (fast 503) or, without a limit, collapses. A slow synchronous dependency inflates every request's service time and drains the concurrency pool — the classic cascade trigger.`,
    metrics: [
      'Latency p50/p99 (and the queue-wait component)',
      'Request rate; concurrent in-flight requests',
      'Error rate; shed/drop rate',
      'Saturation — utilization ρ, CPU %, memory %, worker-pool slots in use',
    ],
    capacity: `A 4-vCPU instance at ~40 ms service time handles ~100 concurrent and ~2.5k rps before ρ gets uncomfortable. Add a synchronous 20 ms DB call and effective service time — and required capacity — jump by half.`,
    pairedWith: [
      { type: 'loadBalancer', why: 'distributes traffic across replicas and ejects dead ones — the thing that makes "add an instance" work' },
      { type: 'cache', why: 'absorbs hot reads so the tier spends its capacity on real work, not repeated lookups' },
      { type: 'dbProxy', why: 'multiplexes the tier’s many connections onto the few the database can hold' },
      { type: 'queue', why: 'moves slow or bursty work off the request path so the handler returns fast' },
    ],
    mistakes: [
      'Holding session or file state locally, which forces sticky sessions and breaks horizontal scaling',
      'Unbounded request queues — the instance dies instead of shedding',
      'Synchronous fan-out to slow dependencies with no timeout, so one bad service drains the pool',
      'Autoscaling too slowly for the traffic shape, so the spike is over before capacity arrives',
    ],
    concepts: ['golden-signals', 'cascading-failure', 'backpressure'],
    further: [
      { label: 'Google SRE Book — Handling Overload', url: 'https://sre.google/sre-book/handling-overload/' },
      { label: 'Brendan Gregg — Utilization, Saturation, Errors (USE)', url: 'https://www.brendangregg.com/usemethod.html' },
    ],
  },

  worker: {
    type: 'worker',
    cluster: 'compute',
    tagline: 'A pool of processes that pull tasks from a queue and execute them asynchronously, decoupled from the request that created them.',
    problem: `Some work is slow, bursty, or allowed to fail and retry — sending email, resizing images, processing payments, rebuilding indexes. Doing it inside the request makes the user wait and couples their success to a flaky dependency.`,
    mechanism: `Competing consumers: each worker takes one message, processes it, acks on success. Failures redeliver (visibility timeout) and, after N attempts, land in a dead-letter queue. Throughput = per-task rate × worker count; raise it by adding workers or partitions. Autoscale on queue depth or consumer lag, not CPU.`,
    whenToUse: `Anything that can be done after the response: notifications, media processing, ETL, webhooks, deferred writes. Alternative: a serverless function triggered by the queue (same model, no pool to manage, but cold starts and concurrency caps). Do it inline only when the caller genuinely needs the result now.`,
    failure: `If sustained task rate exceeds drain rate, the backlog and oldest-message age grow without bound until retention drops messages. Poison messages loop forever without a DLQ. Non-idempotent handlers double-charge or double-send on redelivery. An unwatched DLQ silently fills.`,
    metrics: [
      'Task processing latency; end-to-end age (enqueue → done)',
      'Dequeue rate vs enqueue rate; queue depth / backlog',
      'Failure and redelivery rate; DLQ size and arrival rate',
      'Worker count and utilization',
    ],
    capacity: `Backlog ÷ (drain rate − arrival rate) = recovery time. If workers drain 500/s and 700/s is arriving, the backlog grows 200/s and never recovers without more workers.`,
    pairedWith: [
      { type: 'queue', why: 'the buffer workers pull from — it absorbs bursts the worker pool can catch up on later' },
      { type: 'pubsubTopic', why: 'a fan-out source so one event feeds several independent worker pools' },
      { type: 'sqlDatabase', why: 'the store workers write results to — often the point of the async job' },
    ],
    mistakes: [
      'Non-idempotent handlers, so a redelivery duplicates the side effect',
      'No dead-letter queue, or one nobody alerts on',
      'Scaling workers on CPU instead of backlog — you fall behind or over-provision',
      'Assuming message ordering across competing consumers',
    ],
    concepts: ['backpressure', 'idempotency', 'delivery-semantics'],
    further: [
      { label: 'Enterprise Integration Patterns — Competing Consumers', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/CompetingConsumers.html' },
      { label: 'AWS — Amazon SQS best practices', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html' },
    ],
  },

  serverlessFn: {
    type: 'serverlessFn',
    cluster: 'compute',
    tagline: 'Managed functions that scale per-request from zero to a concurrency ceiling — you supply code, the platform supplies (and bills) the compute.',
    problem: `Provisioning servers for spiky or low-volume workloads means paying for idle capacity and still guessing wrong on the peak. Serverless removes capacity planning — at the cost of cold starts and a hard, account-level concurrency limit.`,
    mechanism: `Each concurrent invocation gets its own isolated environment. A **cold start** (new environment: load runtime + code) adds latency to some fraction of calls; warm invocations skip it. Concurrency scales elastically up to \`maxConcurrency\`; past that, calls are throttled (429). Effective service time ≈ execTime + coldStartRate × coldStartCost. No connection pooling across invocations by default — each one may open its own DB connection.`,
    whenToUse: `Spiky, event-driven, or low-baseline work: webhooks, cron, glue between services, upload processing. Alternatives: a container service (Fargate/Cloud Run) when you need long-lived connections or runtimes over the size/time limits; a plain server tier for steady high volume where per-request billing loses.`,
    failure: `A traffic spike past \`maxConcurrency\` throttles — the excess is dropped, not queued. Cold-start latency spikes after idle periods or a deploy. Each invocation opening a DB connection exhausts the database in a burst (needs a proxy). Long tasks hit the execution-time limit.`,
    metrics: [
      'Duration p50/p99; cold-start rate and cold-start latency',
      'Invocation rate; concurrent executions vs the limit',
      'Throttle (429) rate; error rate',
      'Downstream connection count opened per burst',
    ],
    capacity: `Cold starts range from tens of ms (lightweight runtimes) to seconds (large JVM/.NET). Account concurrency limits are in the hundreds to low thousands by default. Execution caps are commonly ~15 minutes and payloads a few MB.`,
    pairedWith: [
      { type: 'dbProxy', why: 'multiplexes the many short-lived connections a burst of invocations opens onto a few the DB can hold' },
      { type: 'queue', why: 'gives bursty triggers a buffer so throttling becomes lag instead of dropped work' },
      { type: 'apiGateway', why: 'the usual front door — routing, auth and rate limiting for HTTP-triggered functions' },
    ],
    mistakes: [
      'Ignoring cold starts in the latency budget for user-facing paths',
      'One DB connection per invocation with no proxy — a burst exhausts the database',
      'Assuming infinite scale — the concurrency ceiling throttles and drops',
      'Packing slow or long-running work into a function instead of a container',
    ],
    concepts: ['golden-signals', 'backpressure'],
    further: [
      { label: 'AWS — Lambda scaling and concurrency', url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html' },
      { label: 'AWS — Operating Lambda: performance & cold starts', url: 'https://aws.amazon.com/blogs/compute/operating-lambda-performance-optimization-part-1/' },
    ],
  },

  streamProcessor: {
    type: 'streamProcessor',
    cluster: 'compute',
    tagline: 'A stateful engine that consumes event streams and produces derived streams — windowed aggregates, joins, enrichment — continuously.',
    problem: `Some questions ("orders per minute per region", "join clicks to impressions within 5s") can't wait for a nightly batch and can't be answered by a stateless consumer. You need per-key state that survives restarts and processing that keeps up with the stream.`,
    mechanism: `Parallel tasks (one per partition) each hold local state — in-memory or spilled to an embedded store like RocksDB. **Checkpointing** periodically snapshots that state so a failed task resumes without reprocessing everything; the checkpoint pause adds amortized latency to every record. Throughput = per-record rate × parallelism, capped by partition count. Large state slows per-record processing (compaction, spill I/O). Flink, Kafka Streams, Spark Structured Streaming.`,
    whenToUse: `Continuous transforms, windowed aggregations, and stream-to-stream joins with low latency. Alternatives: a plain worker for stateless per-message work; a batch job when minutes-to-hours latency is fine and the logic is simpler to reason about in bulk.`,
    failure: `If record arrival outpaces processing, consumer lag grows without bound. Checkpoint stalls compound under load — a 200 ms stall every 10 s is 2% latency tax that worsens as state grows. Rebalancing on a task failure re-reads state and briefly halts progress. State that outgrows memory thrashes.`,
    metrics: [
      'Per-record processing latency; checkpoint duration and stall time',
      'Records/s in vs out; consumer lag per partition',
      'State size per task; failed-checkpoint rate',
      'Parallelism (task slots) vs partition count',
    ],
    capacity: `Parallelism can't exceed partition count — one partition, one consumer. State in the tens of GB per task is workable with RocksDB; beyond that, latency degrades. Checkpoint interval trades recovery time against steady-state overhead.`,
    pairedWith: [
      { type: 'pubsubTopic', why: 'the input stream — a partitioned log the processor reads with per-key ordering' },
      { type: 'analyticsDb', why: 'the sink for materialized aggregates queried by dashboards' },
      { type: 'cdcConnector', why: 'feeds it a change stream from a database so it can enrich or join against live data' },
    ],
    mistakes: [
      'Parallelism above partition count — the extra tasks sit idle',
      'Checkpoint interval too aggressive, so the stall tax dominates latency',
      'Unbounded state (no TTL on keys) that eventually outgrows memory',
      'Treating it as stateless and losing aggregates on every restart',
    ],
    concepts: ['delivery-semantics', 'backpressure'],
    further: [
      { label: 'Kleppmann — DDIA ch. 11, Stream Processing', url: 'https://dataintensive.net/' },
      { label: 'Apache Flink — Stateful stream processing', url: 'https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/stateful-stream-processing/' },
    ],
  },

  batchJob: {
    type: 'batchJob',
    cluster: 'compute',
    tagline: 'Work that runs on a schedule over a bounded dataset — nightly ETL, report generation, cleanup, reindexing.',
    problem: `Some processing is naturally periodic and doesn't need to be continuous: recompute recommendations, roll up yesterday's metrics, expire stale rows. Running it as a stream is overkill; running it inline is impossible. But a batch that spikes load on a shared datastore can starve online traffic.`,
    mechanism: `A scheduler (cron, Airflow, a cloud scheduler) triggers a run every \`intervalSec\`. Each run processes \`recordsPerRun\` records at \`recordServiceMs\` each, across \`parallelism\` workers. Modeled as an *average* rate — \`recordsPerRun / intervalSec\` — it is a steady background load on whatever it reads and writes. The real shape is a burst: the whole run's work compressed into its actual duration.`,
    whenToUse: `Periodic, bounded, latency-insensitive work: ETL into a warehouse, denormalization, data retention, model retraining. Alternatives: a stream processor when the same output is needed continuously; a worker queue when the trigger is an event rather than a clock.`,
    failure: `A run that takes longer than its interval overlaps the next one — two runs compete, load doubles, and it spirals. The burst can saturate a shared database and inflate online latency. A failed partial run leaves half-written derived data. Growing input eventually blows the run past its window.`,
    metrics: [
      'Run duration vs interval (headroom before overlap)',
      'Records processed per run; per-record latency',
      'Average and peak downstream load contributed',
      'Run success/failure; time since last successful run',
    ],
    capacity: `Duty cycle ρ = (recordsPerRun × recordServiceMs) / (intervalSec × parallelism × 1000). Above ~0.5 the run has little slack; at 1.0 it never finishes before the next trigger.`,
    pairedWith: [
      { type: 'analyticsDb', why: 'the usual destination — batch ETL lands bulk rows a warehouse ingests cheaply' },
      { type: 'objectStore', why: 'staging area for input/output files between stages of a pipeline' },
      { type: 'sqlDatabase', why: 'the source it reads; run it against a replica so it never competes with online writes' },
    ],
    mistakes: [
      'No guard against a run overrunning its interval and overlapping the next',
      'Reading from the primary database instead of a replica, so the batch starves online traffic',
      'Modeling it as an average when the burst is what saturates the datastore',
      'No idempotency, so a re-run after a partial failure double-applies',
    ],
    concepts: ['backpressure', 'idempotency'],
    further: [
      { label: 'Kleppmann — DDIA ch. 10, Batch Processing', url: 'https://dataintensive.net/' },
      { label: 'Apache Airflow — Best practices', url: 'https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html' },
    ],
  },

  // ==== DATA & STORAGE =================================================
  sqlDatabase: {
    type: 'sqlDatabase',
    cluster: 'data',
    tagline: 'A durable, transactional store with a fixed schema and a relational query language — ACID guarantees over structured data.',
    problem: `Applications need a system of record that enforces integrity, answers ad-hoc queries with joins, and never loses a committed write. The forces: strong consistency and rich queries versus write scalability; schema safety versus flexibility; single-primary simplicity versus availability during failover.`,
    mechanism: `ACID via a write-ahead log (durability + crash recovery) and MVCC or locking for isolation; a B-tree (or LSM) storage engine. The WAL is also the replication and CDC source. **Scale reads** with async read replicas — multiplies read throughput, gives warm standbys, reversible; cost is replication lag. **Scale writes/storage**: vertical first (simplest, goes far), then functional partitioning, then sharding (last resort — breaks cross-shard joins and transactions). **HA**: primary + standby with automatic failover in seconds to tens of seconds.`,
    whenToUse: `The default for anything needing transactions, joins, or constraints — money, inventory, identity, orders. Alternatives: NoSQL KV/document for horizontal write scale and flexible schema (you give up joins and multi-key transactions); an OLAP store for analytics (never on the OLTP primary); distributed SQL for horizontal scale with SQL semantics, at a write-latency cost. Reach for these only when a primary + replicas + cache provably won't fit.`,
    failure: `**Connection exhaustion** — each connection is a backend process with real memory; the default limit is ~100, and new requests block once it's hit. Lock contention and long transactions stall writers and *inflate replication lag*. A replica promoted with lag loses data; weak fencing risks split-brain. Hot rows, vacuum/compaction I/O storms, a single missing index turning a spike into a meltdown, and the write-unavailable window during failover.`,
    metrics: [
      'Query latency p50/p99; QPS split read vs write',
      'Active vs idle connections; connection wait time',
      'Replication lag (seconds and bytes)',
      'Lock waits / deadlocks; buffer cache hit ratio; disk IOPS and free space; long-running transaction age',
    ],
    capacity: `One tuned primary handles thousands to tens of thousands of TPS and low-TB data comfortably. \`max_connections\` belongs in the low hundreds, not thousands. Replication lag is normally milliseconds but grows without bound under write bursts or a slow replica.`,
    pairedWith: [
      { type: 'dbProxy', why: 'the app’s thousands of connections vastly exceed what the DB can hold; the pooler multiplexes them onto a few and absorbs connection spikes' },
      { type: 'cache', why: 'offloads hot reads so the primary’s capacity goes to writes and consistency-critical reads' },
      { type: 'cdcConnector', why: 'turns the WAL into an event stream to feed search, cache invalidation and analytics — no dual-write bugs' },
      { type: 'objectStore', why: 'keeps blobs out of rows; store a key/URL instead' },
    ],
    mistakes: [
      'Not sizing the connection pool — thousands of app connections topple the DB; a too-small pool just queues in the app',
      'Reading your own writes from a lagging replica and showing stale data',
      'Sharding before exhausting vertical scaling + replicas + cache',
      'Running analytics on the OLTP primary; assuming failover is instant and lossless; storing large blobs in rows',
    ],
    concepts: ['replication', 'sharding', 'cap', 'relational'],
    further: [
      { label: 'Kleppmann — DDIA ch. 5 & 6', url: 'https://dataintensive.net/' },
      { label: 'HikariCP — About Pool Sizing', url: 'https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing' },
      { label: 'PostgreSQL wiki — Number Of Database Connections', url: 'https://wiki.postgresql.org/wiki/Number_Of_Database_Connections' },
    ],
  },

  dbProxy: {
    type: 'dbProxy',
    cluster: 'data',
    tagline: 'A connection pooler that multiplexes many client connections onto a few backend database connections, and shields the database from connection spikes.',
    problem: `An app tier of thousands of threads (or serverless invocations) wants its own database connection each. The database can hold ~100. Without something in between, the database falls over on connections alone, long before it runs out of CPU or IOPS.`,
    mechanism: `Clients connect to the proxy; the proxy keeps a small pool of real backend connections and hands one to a client only for the duration of a query or transaction, then returns it. **Session** pooling holds a connection for the whole client session (least multiplexing); **transaction** pooling releases it after each transaction (much more); **statement** pooling, after each statement (most, but breaks prepared statements and session state). PgBouncer, RDS Proxy, ProxySQL, and app-side pools like HikariCP.`,
    whenToUse: `Any time app concurrency exceeds a sensible database connection count — especially serverless, autoscaling fleets, or many small services sharing one database. Alternative: a well-configured app-side pool alone if you have few, long-lived app instances. Not a substitute for read replicas or sharding — it caps concurrency, it doesn't add capacity.`,
    failure: `If backend connections + the wait queue are all busy, new clients block or time out — the proxy becomes the bottleneck instead of the DB. Transaction pooling with code that relies on session state (temp tables, \`SET\`) breaks subtly. A proxy outage takes every client with it. Pool too small → queueing; too large → you've just moved the exhaustion to the DB.`,
    metrics: [
      'Client wait time for a backend connection; query latency added',
      'Backend connections in use vs pool size; client connections',
      'Wait-queue depth; connection acquisition timeouts',
      'Downstream DB connection count (should be flat and small)',
    ],
    capacity: `A common sizing rule for the *backend* pool: \`(DB_cores × 2) + effective_spindles\` — often 10–30 total, not hundreds. Transaction pooling can front thousands of clients on that.`,
    pairedWith: [
      { type: 'sqlDatabase', why: 'the thing it protects — the pooler is what lets a big fleet share a connection-limited primary' },
      { type: 'apiServer', why: 'the client tier whose connection storms it absorbs' },
      { type: 'serverlessFn', why: 'each invocation would otherwise open its own connection; the proxy makes serverless + a relational DB viable' },
    ],
    mistakes: [
      'Pool sized in the hundreds — you’ve just relocated connection exhaustion to the database',
      'Transaction-mode pooling with code that depends on session state',
      'Treating the proxy as free capacity rather than a concurrency cap',
      'No monitoring on wait-queue depth, so "the DB is slow" is really "the pool is full"',
    ],
    concepts: ['relational', 'backpressure'],
    further: [
      { label: 'HikariCP — About Pool Sizing', url: 'https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing' },
      { label: 'AWS — Amazon RDS Proxy', url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html' },
    ],
  },

  cache: {
    type: 'cache',
    cluster: 'data',
    tagline: 'A fast, usually in-memory store that keeps a copy of expensive-to-produce data close to the reader, so most requests skip the origin.',
    problem: `Databases and computations are slow and capacity-limited, and reads dominate most workloads. You want low latency and origin offload — but every cache trades freshness for speed and introduces a second source of truth to keep consistent.`,
    mechanism: `**Placement**: browser, CDN edge, reverse proxy, in-process, a distributed tier (Redis/Memcached), the DB buffer pool. **Read**: cache-aside (app populates on miss — simple, resilient) or read-through. **Write**: write-through (sync, consistent, slower), write-behind (async, fast, risk of loss), write-around (fill on read). **Invalidation**: TTL, explicit delete on write, versioned keys, event-driven via CDC. **Eviction**: LRU/LFU/TTL when memory is full.`,
    whenToUse: `Hot, read-heavy, tolerably-stale data — sessions, rendered fragments, lookup tables, hot rows. Alternatives: a read replica (no invalidation logic, but scales throughput not latency and still lags); a materialized view (durable and queryable, but write amplification); a CDN for static/geographic. Don't cache write-heavy, strongly-consistent, or low-hit-ratio data.`,
    failure: `**Stampede** — a hot key expires and thousands of requests hit the origin at once. **Cold cache** after a restart/deploy overloads the origin. **Penetration** — misses for keys that don't exist always hit the DB. **Hot key** exceeds one node's throughput. Eviction thrash when the working set exceeds memory collapses the hit ratio. And a cache treated as a hard dependency (non-cache-aside code) takes the site down when it's down.`,
    metrics: [
      'Hit ratio (overall and per key-class)',
      'Latency p50/p99; get/set rate',
      'Evictions/s; memory used vs max; expired keys/s',
      'Origin QPS with cache vs the modelled without-cache figure',
    ],
    capacity: `A single Redis node handles ~100k–1M+ simple ops/s and tens of GB usefully; beyond that, shard or replicate. Network and serialization often cost more than the lookup itself.`,
    pairedWith: [
      { type: 'sqlDatabase', why: 'the canonical pairing — the cache absorbs read load so the primary is free for writes and consistency-critical reads' },
      { type: 'cdcConnector', why: 'event-driven invalidation keeps entries fresh without brittle manual deletes scattered through write paths' },
      { type: 'apiServer', why: 'a shared cache is what lets the app tier stay stateless (shared sessions), which frees the load balancer from sticky sessions' },
    ],
    mistakes: [
      'No stampede protection — bare TTLs, all keys expiring together',
      'Treating the cache as durable (write-behind with no recovery plan)',
      'Not measuring the hit ratio — a low-hit cache is pure overhead and added risk',
      'Not caching negative results (penetration); making the cache a silent hard dependency',
    ],
    concepts: ['caching', 'in-memory-kv', 'replication'],
    further: [
      { label: 'system-design-primer — Cache', url: 'https://github.com/donnemartin/system-design-primer#cache' },
      { label: 'Redis — Cache stampede prevention', url: 'https://redis.antirez.com/fundamental/cache-stampede-prevention.html' },
      { label: 'AWS — Caching best practices', url: 'https://aws.amazon.com/caching/best-practices/' },
    ],
  },

  objectStore: {
    type: 'objectStore',
    cluster: 'data',
    tagline: 'Durable, effectively unlimited storage for blobs — images, video, backups, logs, data-lake files — addressed by key over HTTP.',
    problem: `Large binary data doesn't belong in a database (it bloats rows, backups, and the buffer pool) or on a single disk (capacity and durability limits). You want cheap, massively scalable, highly durable storage — accepting eventual consistency on overwrites and higher per-request latency than a local disk.`,
    mechanism: `A flat key → object namespace, replicated across many machines and availability zones for very high durability. GET/PUT/DELETE over HTTP; no partial updates (rewrite the whole object). Reads and writes scale horizontally with request rate. A CDN usually sits in front for hot objects. Storage classes trade retrieval latency and cost (standard vs infrequent-access vs archive).`,
    whenToUse: `User uploads, media, static site assets, backups, ML datasets, log/event archives, data-lake tables. Alternatives: a block device when you need a filesystem and low-latency random writes; a database when the data is small, structured, and queried by field rather than fetched whole.`,
    failure: `Rarely "down", but per-request latency (tens to hundreds of ms) makes it wrong for hot-path small reads without a cache/CDN. Listing a huge bucket is slow and paginated. Read-after-overwrite can briefly return the old version. A hot key prefix can throttle. Cost surprises come from request counts and cross-region egress, not storage.`,
    metrics: [
      'GET/PUT latency p50/p99; request rate',
      'Error / throttle (503 SlowDown) rate',
      'Bytes stored, bytes transferred (egress)',
      'CDN offload ratio for served objects',
    ],
    capacity: `Effectively unlimited total size and object count. Per-prefix request rates are high but not infinite (thousands of requests/s before you spread the key space). Single-object size limits are in the TB range with multipart upload.`,
    pairedWith: [
      { type: 'cdn', why: 'caches hot objects at the edge so the store handles only cache-fill, not user traffic' },
      { type: 'sqlDatabase', why: 'holds the metadata and the object key; the blob itself stays out of the rows' },
      { type: 'batchJob', why: 'reads and writes bulk files here as the staging ground between pipeline stages' },
    ],
    mistakes: [
      'Serving hot small objects directly from the store instead of through a CDN/cache',
      'Storing blobs in the database "for simplicity" and paying for it in backups and cache pressure',
      'Assuming read-after-write consistency on overwrites',
      'Ignoring request-count and egress costs, which dwarf storage cost at scale',
    ],
    concepts: ['caching', 'cap'],
    further: [
      { label: 'AWS — S3 best practices for performance', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html' },
      { label: 'system-design-primer — Object storage', url: 'https://github.com/donnemartin/system-design-primer#object-store' },
    ],
  },

  searchIndex: {
    type: 'searchIndex',
    cluster: 'data',
    tagline: 'An inverted-index cluster (Elasticsearch/OpenSearch) built for full-text search, filtering, and ranking — not for being a system of record.',
    problem: `Relational \`LIKE '%term%'\` scans can't do relevance ranking, typo tolerance, faceting, or fast text search at scale. A search index does — by maintaining a term → documents map — but it's a derived, eventually-consistent copy of your data, refreshed on a delay.`,
    mechanism: `Documents are analyzed into terms and stored in an **inverted index**, split across **shards** (each a self-contained Lucene index) with **replicas** for read scale and resilience. A query **scatter-gathers** to every shard and merges — so tail latency tracks the slowest shard, and a skewed shard-key makes one shard hot. New documents become searchable only after a **refresh** (near-real-time, ~1s), so reads lag writes. Indexing costs CPU on every write.`,
    whenToUse: `Full-text search, autocomplete, log/observability search, faceted product search, geo queries. Alternatives: the database's own text search for modest needs; a vector DB when "similar meaning" matters more than keyword match. Never the primary store — it's rebuildable from the source of truth.`,
    failure: `Scatter-gather p99 = the slowest shard's p99; one hot shard drags the whole query. A shard with \`replicas: 0\` that loses its node loses those documents from results until restore. Heavy indexing steals CPU from queries. Deep pagination and unbounded aggregations blow up memory. Refresh lag means "I just saved it, why can't I find it?"`,
    metrics: [
      'Query latency p50/p99 (and per-shard); scatter-gather fan-out',
      'Query rate; indexing rate',
      'Rejected queries / thread-pool saturation; refresh lag',
      'Per-shard load skew; heap usage; replica count',
    ],
    capacity: `Keep shards in the tens of GB each; more, smaller shards spread load but add coordination overhead. Query throughput scales with replicas; indexing throughput with primary shards. Refresh interval trades freshness for indexing cost.`,
    pairedWith: [
      { type: 'sqlDatabase', why: 'the system of record; the index is a derived view kept in sync, not the source' },
      { type: 'cdcConnector', why: 'streams row changes from the DB into the index so it stays current without dual writes' },
      { type: 'pubsubTopic', why: 'the transport between CDC and the indexer, buffering bursts of updates' },
    ],
    mistakes: [
      'Using it as the primary store — there’s no transactional guarantee to lose from',
      '`replicas: 0` in production, so a lost node loses query results',
      'A skewed shard key that concentrates load and tail latency on one shard',
      'Expecting read-your-writes — refresh lag means recent writes aren’t searchable yet',
    ],
    concepts: ['sharding', 'replication', 'delivery-semantics'],
    further: [
      { label: 'Elastic — Size your shards', url: 'https://www.elastic.co/guide/en/elasticsearch/reference/current/size-your-shards.html' },
      { label: 'Kleppmann — DDIA ch. 3 (full-text search & fuzzy indexes)', url: 'https://dataintensive.net/' },
    ],
  },

  analyticsDb: {
    type: 'analyticsDb',
    cluster: 'data',
    tagline: 'A columnar OLAP store (Snowflake, BigQuery, Redshift, ClickHouse) built for large scans and aggregations over historical data — seconds-scale, concurrency-slot bound.',
    problem: `Analytical queries scan millions of rows across a few columns; running them on the OLTP primary competes with transactions and locks up the box. An OLAP store stores data by column, compresses hard, and parallelizes scans — at the cost of slow single-row lookups and no real transactions.`,
    mechanism: `Columnar storage: a query reads only the columns it touches, heavily compressed, scanned in parallel. Concurrency is bounded by **slots / warehouse size**, not a connection pool — past the slot count, queries queue (or error if queuing is off). A **result cache** returns repeated identical queries instantly. Latency is seconds, not milliseconds. Fed by batch ETL or a CDC → stream pipeline, never on the request path.`,
    whenToUse: `Dashboards, BI, ad-hoc analysis, reporting, ML feature extraction over history. Alternatives: a time-series store for metrics specifically; a search index for text; the OLTP DB for small, indexed, point queries. Keep it off the request path — reach it via CDC + a warehouse, not a synchronous call from a user request.`,
    failure: `Slots are the ceiling: the 9th concurrent query on an 8-slot warehouse waits for one to finish (or errors). A giant unfiltered scan monopolizes slots. Result-cache misses on slightly-varying queries. Cost scales with bytes scanned — a \`SELECT *\` over a wide table is expensive. Second-scale latency makes it unusable for anything interactive without pre-aggregation.`,
    metrics: [
      'Query latency (seconds) p50/p99; queue wait time',
      'Concurrent queries vs slot count; queued query count',
      'Bytes / partitions scanned per query; result-cache hit rate',
      'Warehouse utilization; cost per query',
    ],
    capacity: `Warehouse "size" doubles compute (and cost) per step. Concurrency slots are single digits to low tens per warehouse; scale concurrency by adding warehouses, not by making one bigger. Scan time is roughly proportional to bytes read.`,
    pairedWith: [
      { type: 'cdcConnector', why: 'streams committed changes off the OLTP primary so analytics never touches it directly' },
      { type: 'streamProcessor', why: 'pre-aggregates the firehose into rollups the warehouse ingests and dashboards query cheaply' },
      { type: 'batchJob', why: 'the classic loader — nightly ETL lands bulk historical rows' },
    ],
    mistakes: [
      'Putting it on the request path — second-scale latency and slot contention make it a terrible synchronous dependency',
      'Running analytics on the OLTP primary instead, and locking up transactions',
      'Sizing up one warehouse for concurrency instead of adding warehouses',
      'Unfiltered `SELECT *` scans that burn slots and money',
    ],
    concepts: ['time-series', 'sharding', 'backpressure'],
    further: [
      { label: 'Snowflake — Warehouse concurrency & queuing', url: 'https://docs.snowflake.com/en/user-guide/warehouses-considerations' },
      { label: 'Kleppmann — DDIA ch. 3 (column-oriented storage)', url: 'https://dataintensive.net/' },
    ],
  },

  vectorDb: {
    type: 'vectorDb',
    cluster: 'data',
    tagline: 'A store for high-dimensional embedding vectors with approximate nearest-neighbour search — the retrieval layer for semantic search, recommendations, and RAG.',
    problem: `"Find things with similar meaning" is a nearest-neighbour problem in a space of hundreds or thousands of dimensions. Exact search is linear in the dataset and too slow; a naive index doesn't exist for high dimensions. Vector DBs use approximate indexes that trade a little recall for orders-of-magnitude speed — and they're memory-hungry.`,
    mechanism: `Each item is an embedding vector. An **ANN index** — HNSW (graph, fast + accurate, high memory), IVF (clustered, tunable), or flat (exact, slow) — makes top-K similarity search sub-linear. Query cost scales with dimensions, K, and dataset size; \`flat\` scales linearly, \`hnsw\` barely. The index typically lives in RAM: \`vectors × dimensions × 4 bytes × overhead\`. Exceed RAM and it spills to disk, and latency falls off a cliff.`,
    whenToUse: `Semantic search, RAG context retrieval, recommendations, dedup, image similarity. Alternatives: a search index when keyword match is enough (often combine both — hybrid search); \`pgvector\` inside Postgres for modest scale without a new system. Not a general store — it holds vectors + a little metadata, not your documents.`,
    failure: `Index outgrows RAM → spill → 10×+ latency. \`flat\` index saturates where \`hnsw\` would hold, because query cost is linear. Recall silently drops as you tune for speed (fewer probes / lower \`ef\`). Rebuilding or heavily updating an HNSW graph is expensive. High dimensionality inflates both memory and query time.`,
    metrics: [
      'Query latency p50/p99; recall @ K (quality, not just speed)',
      'Query rate; index build / upsert rate',
      'Index size vs available RAM; spill / disk-read rate',
      'Pool utilization; dimensions × vector count',
    ],
    capacity: `1M × 768-dim float32 vectors ≈ 3 GB raw, ~2× with an HNSW graph. HNSW query time is roughly constant with dataset size; flat is linear. Keep the working index in memory.`,
    pairedWith: [
      { type: 'searchIndex', why: 'hybrid retrieval — keyword filter in the search index, semantic rank in the vector DB; each covers the other’s blind spot' },
      { type: 'objectStore', why: 'holds the source documents/images; the vector DB holds only their embeddings and IDs' },
      { type: 'apiServer', why: 'the embedding + retrieval service that turns a query into a vector and fetches neighbours' },
    ],
    mistakes: [
      'Letting the index exceed RAM and eating a latency cliff',
      'Choosing `flat` for a dataset that only `hnsw` can serve at the target load',
      'Tuning for latency without measuring recall — fast but wrong',
      'Storing full documents in it instead of just vectors + IDs',
    ],
    concepts: ['caching', 'sharding'],
    further: [
      { label: 'Pinecone — HNSW & ANN algorithms', url: 'https://www.pinecone.io/learn/series/faiss/hnsw/' },
      { label: 'pgvector — README', url: 'https://github.com/pgvector/pgvector' },
    ],
  },

  // ==== MESSAGING & STREAMING ==========================================
  queue: {
    type: 'queue',
    cluster: 'messaging',
    tagline: 'A durable buffer where each message is delivered to exactly one consumer among a pool of competing workers.',
    problem: `A fast producer and slower, failure-prone processing shouldn't be coupled synchronously. You want to absorb spikes, retry safely, and scale workers independently — accepting at-least-once delivery (so duplicates) and unbounded lag if consumers can't keep up.`,
    mechanism: `Producer → queue → **competing consumers**; each message goes to one worker, which acks on success. A visibility timeout re-hides an un-acked message for redelivery; after N attempts it goes to a **dead-letter queue**. Throughput scales with worker count. FIFO vs best-effort ordering; delay and priority variants. SQS, RabbitMQ, Redis streams.`,
    whenToUse: `Task distribution where each unit must be done once by someone — send email, resize image, process payment. Alternatives: a **pub/sub topic** when many independent consumers each need the event; a direct synchronous call when the caller needs the result now and the callee is fast; a log (Kafka) when you need replay plus high fan-out plus partitioned ordering.`,
    failure: `Unbounded **queue depth** when consumers fall behind — latency grows without limit until retention drops messages. Poison messages loop without a DLQ. Duplicate deliveries corrupt state without idempotency. Visibility timeout too short → double processing; too long → slow retries. Ordering is lost across competing consumers. An unmonitored DLQ silently fills.`,
    metrics: [
      'Queue depth / backlog; age of the oldest message',
      'Enqueue rate vs dequeue rate',
      'Consumer count and utilization; processing latency',
      'Redelivery rate; DLQ size and arrival rate; ack failures',
    ],
    capacity: `Managed queues scale to very high throughput, but per-message overhead is ~milliseconds and the real ceiling is consumer throughput × worker count. Recovery time = backlog ÷ (drain − arrival).`,
    pairedWith: [
      { type: 'worker', why: 'the competing-consumer pool that drains it — add workers to raise throughput' },
      { type: 'apiServer', why: 'the producer — the queue lets the handler return before the slow work is done' },
      { type: 'circuitBreaker', why: 'on the consumer’s downstream calls, so a failing dependency doesn’t become an infinite redelivery storm' },
    ],
    mistakes: [
      'Using a queue to paper over a consumer pool that is simply too small',
      'No idempotency, so a redelivery duplicates the side effect',
      'No DLQ, or a DLQ nobody alerts on',
      'Assuming ordering across competing consumers; treating the broker as an infinite buffer',
    ],
    concepts: ['backpressure', 'delivery-semantics', 'idempotency'],
    further: [
      { label: 'Enterprise Integration Patterns — Point-to-Point Channel', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/PointToPointChannel.html' },
      { label: 'AWS — SQS vs SNS vs EventBridge', url: 'https://aws.amazon.com/blogs/compute/choosing-between-messaging-services-for-serverless-applications/' },
    ],
  },

  pubsubTopic: {
    type: 'pubsubTopic',
    cluster: 'messaging',
    tagline: 'A channel where each published message is delivered to every subscriber, each consuming independently at its own pace.',
    problem: `One event, many independent reactions — "order placed" fans out to email, analytics, inventory, and fraud — and the publisher shouldn't know or care who listens. You get loose coupling and easy extension, but lose any backpressure signal to the publisher and must manage per-subscriber reliability.`,
    mechanism: `Publisher → topic → N **subscriptions**, each with its own cursor. **Ephemeral** (messages only while connected — Redis pub/sub) vs **durable** (per-subscriber queue that survives downtime — SNS+SQS, Google Pub/Sub, Kafka consumer groups). Each subscription can itself fan out to a competing-consumer pool. Log-backed variants (Kafka) allow replay from an offset; partitions cap per-group parallelism.`,
    whenToUse: `Event-driven architecture and notification: many services independently reacting to the same fact. Alternatives: a **queue** when exactly one worker should handle each message (adding a subscriber to a topic *also* gets the message; adding a consumer to a queue *steals* it); a **CDC connector** when the "events" are really database row changes.`,
    failure: `A slow subscriber's backlog grows independently (durable) or messages are silently dropped (ephemeral). No backpressure to the publisher → the broker fills. **Fan-out amplification**: effective load = publish rate × subscriptions × retries. A schema change breaks unknown consumers. Every subscriber needs idempotency (duplicates + reordering per subscription). "Who consumes this topic?" becomes unknowable without a registry.`,
    metrics: [
      'Publish rate; per-subscription delivery rate',
      'Consumer lag / unacked backlog per subscription; oldest-unacked age',
      'Subscriber count; redelivery rate; DLQ per subscription',
      'End-to-end propagation latency',
    ],
    capacity: `Effective throughput = publish rate × number of subscriptions — a topic with 50 subscribers is 50× the delivery volume. Kafka partition count caps a consumer group's parallelism (one partition → one consumer in the group).`,
    pairedWith: [
      { type: 'worker', why: 'each subscription feeds an independent worker pool that reacts to the event in its own way' },
      { type: 'cdcConnector', why: 'the standard producer — turns DB commits into a topic other services subscribe to, no dual writes' },
      { type: 'streamProcessor', why: 'a subscriber that aggregates or joins the stream rather than handling messages one by one' },
    ],
    mistakes: [
      'Using a topic when you need exactly-once processing — every subscriber does the work',
      'Ephemeral pub/sub where durability was needed — messages lost during a deploy',
      'Ignoring fan-out amplification when adding subscribers',
      'No schema registry, so a producer change breaks consumers you didn’t know existed',
    ],
    concepts: ['delivery-semantics', 'backpressure', 'idempotency'],
    further: [
      { label: 'Enterprise Integration Patterns — Publish-Subscribe Channel', url: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/PublishSubscribeChannel.html' },
      { label: 'Confluent — Kafka consumer groups', url: 'https://docs.confluent.io/platform/current/clients/consumer.html' },
    ],
  },

  cdcConnector: {
    type: 'cdcConnector',
    cluster: 'messaging',
    tagline: 'Change Data Capture — tails a database’s write-ahead log and emits every committed row change as an event stream.',
    problem: `You need a database's changes reflected elsewhere — a search index, a cache, a warehouse, another service. Writing to both the DB and the other system in application code is the **dual-write bug**: one succeeds, one fails, and the systems diverge. CDC makes the DB's own log the single source of change events.`,
    mechanism: `The connector reads the WAL / binlog / oplog (or replication slot) — the same stream replicas consume — and publishes an ordered change event per committed row, usually onto a pub/sub topic. It adds a small **lag** (log read + publish). A \`captureRatio\` can filter which tables/changes are emitted. An initial **snapshot** backfills existing rows before switching to the live tail. Debezium, Kafka Connect, native connectors.`,
    whenToUse: `Keeping derived systems in sync with an OLTP database: cache invalidation, search indexing, warehouse ingest, the transactional-outbox relay, cross-service event feeds. Alternative: application-level event publishing (simpler, but reintroduces the dual-write bug); periodic polling (lossy, high-latency, load on the DB).`,
    failure: `Adds end-to-end lag — a downstream is always \`lagMs\` behind the DB. If the connector stops, the replication slot retains WAL and the primary's disk fills. Schema changes in the source can break the event schema. Snapshot of a huge table is slow and load-heavy. It captures *every* change — high write volume becomes high event volume downstream.`,
    metrics: [
      'Capture-to-publish lag; end-to-end lag to consumers',
      'Change events/s emitted vs DB write rate',
      'Connector up/down; replication-slot retained WAL size',
      'Snapshot progress; schema-change / error events',
    ],
    capacity: `Throughput tracks the source DB's write rate. Lag is normally milliseconds to low seconds; it grows without bound if the connector or its downstream stalls (and drags the primary's disk with it via the slot).`,
    pairedWith: [
      { type: 'sqlDatabase', why: 'the source — CDC turns its WAL into events without adding load to query paths or risking dual writes' },
      { type: 'pubsubTopic', why: 'the transport — the change stream lands here for many independent consumers' },
      { type: 'searchIndex', why: 'a common destination — keeps the index current as rows change, no application glue' },
    ],
    mistakes: [
      'Publishing events from application code alongside the DB write (dual-write divergence) instead of using CDC',
      'Not monitoring a stopped connector — the retained WAL fills the primary’s disk',
      'Forgetting the lag: downstreams are never perfectly current',
      'Snapshotting a massive table during peak load',
    ],
    concepts: ['delivery-semantics', 'replication'],
    further: [
      { label: 'Debezium — CDC connectors', url: 'https://debezium.io/documentation/reference/stable/index.html' },
      { label: 'microservices.io — Transactional Outbox', url: 'https://microservices.io/patterns/data/transactional-outbox.html' },
    ],
  },

  // ==== COORDINATION ===================================================
  coordination: {
    type: 'coordination',
    cluster: 'coordination',
    tagline: 'A small, strongly-consistent store (ZooKeeper, etcd, Consul) for the facts a cluster must agree on — leader election, locks, config, service discovery.',
    problem: `Distributed processes need shared truth: who is the leader, which nodes are alive, what the current config is, who holds a lock. That truth must be **linearizable** (everyone sees the same value at the same time) and survive node failures — which means consensus, which means every write pays a quorum round-trip.`,
    mechanism: `An odd-sized **ensemble** (3, 5, 7) runs a consensus protocol (Raft/ZAB/Paxos). A write is committed only when a **majority** acknowledges — so write latency ≈ base + one cross-node round-trip, and it grows modestly with ensemble size. Reads can be served locally (fast, possibly slightly stale) or linearizably (another round-trip). **Watches** notify clients on change — a fan-out that scales with watcher count.`,
    whenToUse: `Leader election, distributed locks, dynamic config, service registry, membership. Keep the data tiny and change-rarely. Alternatives: a database advisory lock for a single simple lock; a config service or feature-flag system for config that doesn't need consensus; a gossip protocol for membership at very large scale.`,
    failure: `Lose the majority (2 of 3 nodes) and it stops accepting writes — by design, to stay consistent — which can freeze everything that depends on it. Write-heavy misuse (using it as a general database, chatty config churn) saturates the consensus path. Thousands of watches on one key create a notification storm on every change. A bigger ensemble tolerates more failures but makes every write slower.`,
    metrics: [
      'Write latency (base + quorum round-trip); read latency by mode',
      'Proposal / commit rate; pending proposals',
      'Ensemble health — leader present, followers in sync, quorum size',
      'Watch count and notification fan-out',
    ],
    capacity: `Built for thousands of small writes/s, not millions. Data in the low MB, not GB. 5 nodes tolerate 2 failures; 7 tolerate 3, at higher write cost. Keep values small and watches bounded.`,
    pairedWith: [
      { type: 'apiServer', why: 'services use it to elect a leader for a singleton job and to discover each other’s addresses' },
      { type: 'sqlDatabase', why: 'distributed-SQL engines lean on the same consensus idea internally for their write path' },
    ],
    mistakes: [
      'Using it as a general-purpose key-value store — the consensus write path can’t take the load',
      'Chatty config churn or large values, saturating the quorum path',
      'Thousands of watches on a hot key, so every update fans out a storm',
      'An even-sized ensemble (no clean majority) or a 2-node "cluster" (no fault tolerance)',
    ],
    concepts: ['cap', 'distributed-sql', 'cascading-failure'],
    further: [
      { label: 'etcd — Why etcd / Raft', url: 'https://etcd.io/docs/latest/learning/why/' },
      { label: 'The Raft paper — In Search of an Understandable Consensus Algorithm', url: 'https://raft.github.io/raft.pdf' },
    ],
  },

  // ==== RESILIENCE =====================================================
  circuitBreaker: {
    type: 'circuitBreaker',
    cluster: 'resilience',
    tagline: 'A client-side state machine that stops calling a failing dependency, so callers fail fast instead of piling up on it.',
    problem: `When a downstream is down or slow, naive callers keep sending requests and blocking threads and connections waiting for timeouts. The failure spreads upstream — a cascade. You want to protect the caller *and* give the callee room to recover, without tripping on every transient blip.`,
    mechanism: `Three states. **Closed** — calls pass; count failures and slow calls over a rolling window. Cross the threshold → **Open** — reject every call immediately (or run a fallback) for a cooldown. After cooldown → **Half-open** — allow a few probe calls; success closes it, failure re-opens. Knobs: window size, failure-rate and slow-call thresholds, minimum call volume, open duration, probe count. It lives *inside* callers (a library) or a sidecar/mesh — not as infrastructure.`,
    whenToUse: `Around every *remote* call to a dependency that can fail independently — other services, third-party APIs, sometimes the database. It complements, not replaces: **timeouts** (bound each call — a breaker with no timeout can't see slow failures), **retries with backoff + jitter** (transient errors only), **bulkheads** (isolate the pool per dependency), and a **fallback** (a breaker with no fallback just turns slow errors into fast errors).`,
    failure: `Thresholds too sensitive → flapping on normal variance. Too lax → never trips, no protection. Per-instance breakers trip at different times (usually fine). A half-open probe storm if every instance probes at once. It *hides* a real prolonged outage if nobody alerts on the Open state. Retries *inside* the breaker inflate the failure count. An untested fallback path fails when it's finally needed.`,
    metrics: [
      'Breaker state (Closed/Open/Half-open) and transition count',
      'Failure rate and slow-call rate in the window; rejected (short-circuited) call count',
      'Downstream latency p99',
      'Fallback execution rate and fallback error rate; retry count per outcome',
    ],
    capacity: `If a dependency's timeout is 10 s and you have 200 worker threads, ~20 hanging req/s saturates the whole pool. The breaker caps that exposure to the probe volume during an outage.`,
    pairedWith: [
      { type: 'externalService', why: 'the flaky third party it guards — the breaker turns "hang on every call" into a bounded fast-fail' },
      { type: 'apiServer', why: 'the caller whose thread/connection pool it protects from a slow dependency' },
      { type: 'apiGateway', why: 'a place to enforce breakers + timeouts uniformly so every team doesn’t hand-roll them' },
    ],
    mistakes: [
      'No timeout on the wrapped call — the breaker never gets a signal fast enough',
      'Retrying without a breaker (retry storm) or without jitter (thundering herd on recovery)',
      'Treating Open as silent success and never alerting — a masked outage',
      'One breaker for many distinct downstreams, so one bad dependency trips calls to healthy ones; an untested fallback',
    ],
    concepts: ['circuit-breakers', 'retries', 'cascading-failure'],
    further: [
      { label: 'Martin Fowler — CircuitBreaker', url: 'https://martinfowler.com/bliki/CircuitBreaker.html' },
      { label: 'Google SRE Book — Addressing Cascading Failures', url: 'https://sre.google/sre-book/addressing-cascading-failures/' },
      { label: 'Resilience4j — Circuit breaker', url: 'https://resilience4j.readme.io/docs/circuitbreaker' },
    ],
  },

  // ==== EXTERNAL SERVICES =============================================
  externalService: {
    type: 'externalService',
    cluster: 'external',
    tagline: 'A third-party dependency you call but don’t control — a payment processor, a maps API, a partner service — with its own latency, error rate, and rate limits.',
    problem: `Your system's reliability now depends on someone else's, and you can't fix their outages, tune their latency, or lift their rate limits. Every synchronous call to them on your request path imports their p99 and their failure modes into yours.`,
    mechanism: `Model it as a station with a fixed service latency, an intrinsic error rate, and often a **rate limit** (requests beyond it get 429s). You interact with it only through its API. Your defenses are all client-side: a tight **timeout**, a **circuit breaker**, **retries with backoff + jitter** for transient errors, **bulkhead** isolation so it can't drain shared pools, and a **fallback** for when it's down.`,
    whenToUse: `Whenever a capability isn't your core competency — payments, email/SMS delivery, identity, geocoding, fraud scoring. The build-vs-buy tradeoff: you save engineering but take on a reliability and rate-limit dependency. Keep it off the critical path where you can (async, queued, cached).`,
    failure: `Its outage is your outage unless you fail fast and degrade. Its latency spike drains your worker pool if there's no timeout. Hitting its rate limit turns success into 429s — retrying naively makes it worse. Its breaking API change or cert expiry is an incident you didn't cause and can't prevent.`,
    metrics: [
      'Call latency p50/p99 (theirs, as you see it); timeout rate',
      'Call rate vs their published rate limit; 429 rate',
      'Error rate by class; circuit-breaker state',
      'Fallback / degraded-mode rate',
    ],
    capacity: `You get whatever quota you're paying for — often a few hundred to a few thousand rps, with burst allowances. Assume it's lower than you'd like and design the backpressure to match.`,
    pairedWith: [
      { type: 'circuitBreaker', why: 'the primary guard — stops your callers piling onto a dependency that’s down' },
      { type: 'queue', why: 'moves the call off the request path so a slow or rate-limited partner becomes lag, not user-facing errors' },
      { type: 'cache', why: 'serves a recent response when the partner is unavailable or to stay under its rate limit' },
    ],
    mistakes: [
      'Calling it synchronously on the request path with no timeout and no breaker',
      'Retrying into a 429 without honouring Retry-After — you extend your own outage',
      'No fallback / degraded mode, so their downtime is fully your downtime',
      'Assuming their rate limit is higher than it is, and getting throttled under normal peak',
    ],
    concepts: ['circuit-breakers', 'retries', 'cascading-failure'],
    further: [
      { label: 'AWS Well-Architected — Reliability Pillar (dependency failures)', url: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html' },
      { label: 'Nygard — Release It! (integration points)', url: 'https://pragprog.com/titles/mnee2/release-it-second-edition/' },
    ],
  },

  identityProvider: {
    type: 'identityProvider',
    cluster: 'external',
    tagline: 'The system that authenticates users and issues/validates tokens — an OAuth/OIDC provider, an internal auth service, or a managed IdP (Auth0, Okta, Cognito).',
    problem: `Every service needs to know *who* is calling and *what* they may do, but re-implementing auth in each one is a security and consistency disaster. Centralize it — and now the IdP is on the critical path of every authenticated request and a very high-value SPOF.`,
    mechanism: `**Token issue** (login → signed JWT / opaque token) is the write-ish path. **Introspection / validation** is the hot path: verify a signature (cheap, offline with the public key) or call the IdP to check an opaque token (a network hop). A **session cache** short-circuits repeated validations. The API gateway usually does validation; the IdP owns key rotation and the user store.`,
    whenToUse: `Any system with more than one service and real users. Managed IdP when auth isn't your differentiator (most cases); self-hosted when you have regulatory or customization needs. Alternative for service-to-service: mTLS via a service mesh, no user IdP involved.`,
    failure: `IdP down → nobody can log in (existing valid tokens may still work until expiry, which is why short-lived tokens + refresh matter). Introspection latency adds to every request without a cache. Key-rotation misconfig rejects all tokens. Rate limits on a managed IdP throttle your login flow during a traffic spike. A leaked signing key is a full compromise.`,
    metrics: [
      'Token-issue latency; introspection/validation latency p99',
      'Auth request rate; session-cache hit ratio',
      'Auth failure rate (bad creds vs system error); 429 rate from a managed IdP',
      'Token TTL and refresh rate',
    ],
    capacity: `Signature validation with a cached public key is microseconds and needs no IdP call. Remote introspection is a full network round-trip — cache it. Managed IdPs cap login/token rps; know the number before your launch.`,
    pairedWith: [
      { type: 'apiGateway', why: 'validates the token at the edge and injects identity claims so downstream services trust them without re-checking' },
      { type: 'cache', why: 'holds validated sessions so the hot path is a local lookup, not an IdP round-trip' },
      { type: 'circuitBreaker', why: 'guards introspection calls so an IdP slowdown doesn’t stall every request' },
    ],
    mistakes: [
      'Calling introspection on every request with no session cache',
      'Long-lived tokens with no revocation story — a stolen token is valid for its whole lifetime',
      'No plan for IdP downtime (should existing sessions keep working?)',
      'Ignoring the managed IdP’s rate limit until the login flow throttles under peak',
    ],
    concepts: ['caching', 'circuit-breakers', 'cascading-failure'],
    further: [
      { label: 'OAuth 2.0 — RFC 6749', url: 'https://datatracker.ietf.org/doc/html/rfc6749' },
      { label: 'OWASP — Authentication Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html' },
    ],
  },

  notificationService: {
    type: 'notificationService',
    cluster: 'external',
    tagline: 'Sends outbound messages — email, SMS, push — usually through a provider (SES, Twilio, FCM) that rate-limits you and can’t be made faster.',
    problem: `Sending a notification inside the request that triggered it couples the user's success to a slow, rate-limited, sometimes-down third party. And the provider will throttle you: past its rate limit, sends fail. You need to decouple, buffer, and retry — without dropping messages or double-sending.`,
    mechanism: `Asynchronous by default: the app enqueues a send; a worker drains the queue at or below the provider's **rate limit**, adding the provider's send latency plus some jitter. Over the limit, the backlog grows (async buffer) rather than erroring. Failed sends retry with backoff; permanent failures (bad address) go to a DLQ. Idempotency keys stop a redelivered job from sending twice.`,
    whenToUse: `Any outbound user messaging: transactional email, OTP SMS, push. Almost always async — the user rarely needs to block on "email sent". Synchronous only for a true real-time confirmation, and even then with a tight timeout and a fallback.`,
    failure: `Sustained send rate above the provider limit grows an unbounded backlog — notifications arrive hours late. Provider outage stalls the queue. No idempotency → users get duplicate emails on a retry. Hard bounces not pruned → sender reputation drops and more mail goes to spam. A synchronous send with no timeout drains the worker pool.`,
    metrics: [
      'Send latency (enqueue → provider-accepted); end-to-end delivery latency',
      'Send rate vs provider rate limit; 429 / throttle rate',
      'Queue depth / backlog; retry rate; DLQ size',
      'Bounce and complaint rate (deliverability)',
    ],
    capacity: `Provider limits vary widely — from a few messages/s on a new account to thousands after warm-up. Treat the limit as the drain rate and size the buffer for the peak burst.`,
    pairedWith: [
      { type: 'queue', why: 'the buffer that turns "over the rate limit" into lag instead of dropped notifications' },
      { type: 'worker', why: 'drains the queue at the provider’s pace and handles retries and DLQ routing' },
      { type: 'circuitBreaker', why: 'on the provider call, so an outage fails fast instead of stalling every send worker' },
    ],
    mistakes: [
      'Sending synchronously in the request path',
      'No idempotency, so a retried job double-sends',
      'Ignoring the provider rate limit until the backlog is hours deep',
      'Not pruning hard bounces, quietly wrecking deliverability',
    ],
    concepts: ['backpressure', 'idempotency', 'retries'],
    further: [
      { label: 'AWS — SES sending quotas & rate limits', url: 'https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html' },
      { label: 'Twilio — Handling rate limits', url: 'https://www.twilio.com/docs/messaging/guides/how-to-use-messaging-services#rate-limits-and-message-queueing' },
    ],
  },
};

export function getComponentDoc(type: ComponentType): ComponentDoc | undefined {
  return COMPONENT_DOCS[type];
}
