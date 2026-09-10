# Live Probe

The Live Probe is an **opt-in** lane that fires real HTTP at one node's endpoint
and charts the measured latency / throughput / error curves next to the model's
predicted curve. It never changes the analytical + discrete-event simulation —
a design you never probe behaves exactly as before.

## What it does

1. **Measure.** Point an `API Server` or `External Service` node at a real local
   endpoint (`http://localhost:3000/…`), pick a load (constant req/s, or a fixed
   pool of virtual users) and a duration, and press **Run probe**. A dedicated
   worker fires `fetch()` at the target, times each request, and streams ~2 Hz
   samples into the Monitor panel's **Measured** view.
2. **Compare.** The **Compare** view overlays the model's steady-state prediction
   (dashed) on the measured curve so you can see the gap.
3. **Calibrate.** *Calibrate model from run* pushes the measured p50 into the
   node's service-time param and the measured error fraction into its error-rate
   param, as a **transient, reversible overlay** (same lifecycle as a chaos
   fault — not saved with the design). Both engines re-solve, so the rest of the
   modelled topology now reflects the real measurement. A chip in the
   bottom-right corner shows the active calibration; `reset` reverts it.

## Target policy

Targets are classified:

- **Private** — `localhost`, `*.localhost`, `*.local`, `127.0.0.0/8`, `::1`,
  RFC1918 IPv4 (`10/8`, `192.168/16`, `172.16/12`), IPv6 ULA (`fc00::/7`). Runs
  immediately.
- **Public** — anything else that parses as `http(s)`. Allowed, but the first run
  against a given host needs a one-time checkbox: *"I own this endpoint or have
  permission to load-test it."* Most public APIs still fail from the browser —
  see below.
- **Always refused** — link-local `169.254/16` (covers the cloud metadata
  endpoint), `fe80::/10`, `0.0.0.0`, and non-`http(s)` schemes.

Hard caps: **500 req/s**, **200 users**, **180 s**, **30 000 total requests**; a
**Stop** button aborts everything in-flight. `429`/`503` responses are backed off
per `Retry-After`; a redirect to another host is recorded as an error, never
followed.

## Public APIs & CORS

The probe runs from the browser, so a public API only responds if it sends
`Access-Control-Allow-Origin` for this origin (many open data / read APIs do;
Stripe / GitHub-authenticated / OpenAI / most write APIs do not). When it
doesn't, every request comes back as a network error with no status or timing —
the results row calls this out and points at the planned local sidecar
(`npx breakpoint-probe`), which does the HTTP in Node and has no CORS wall.

## CORS

The probe runs from the browser, so your dev server must allow this origin.
A non-GET request or a custom header also triggers an `OPTIONS` preflight.

| framework | one-liner |
| --- | --- |
| Express | `app.use(require('cors')())` |
| FastAPI | `app.add_middleware(CORSMiddleware, allow_origins=["*"])` |
| Go (net/http) | `w.Header().Set("Access-Control-Allow-Origin", "*")` |
| Rails | `Rack::Cors` — `allow { origins "*"; resource "*" }` |

## Mixed content

The deployed site is served over HTTPS. Chromium and Firefox let an HTTPS page
reach `http://localhost`, but Safari does not, and any other `http://` target is
blocked. **For the smoothest path, run the app locally** (`npm run dev`, an
`http://` origin) so there is no mixed-content restriction at all.

## Accuracy

Browser-generated load is honest to a few hundred req/s — the per-origin
connection cap (~6 on HTTP/1.1) and main-thread scheduling put a ceiling on it,
and `performance.now()` is coarsened for security. Treat the numbers as
indicative. A local sidecar (`npx breakpoint-probe`, planned) will remove the
CORS, mixed-content and throughput limits by doing the load generation in Node.

## Privacy

The endpoint URL, headers and body live only in memory (`probeStore`). They are
**never** written to `localStorage`, share URLs, or JSON exports, and are cleared
on reload — the same rule as chaos faults.
