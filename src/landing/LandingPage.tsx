import { useEffect, useState, type ReactNode } from 'react';
import { getPreset } from '@/presets';
import { designToHash } from '@/lib/shareUrl';
import { MiniCanvas } from './MiniCanvas';
import { LiveDemo } from './LiveDemo';

const REPO = 'https://github.com/amankumar430206/breakpoint';
const BASE = import.meta.env.BASE_URL;
const SANDBOX = `${BASE}sandbox/`;
const WIKI = `${BASE}wiki/`;

const SHOWCASE = getPreset('ecommerce-checkout');
const SHOWCASE_URL = SHOWCASE ? `${SANDBOX}${designToHash(SHOWCASE)}` : SANDBOX;

const WHENS: [string, string][] = [
  [
    'delete the load balancer',
    "the remaining server's ρ climbs toward 1, the latency curve goes vertical, drops start, the node flips to its saturated state.",
  ],
  ['add app replicas', 'offered load splits across instances, ρ falls, p99 recovers — live.'],
  [
    'remove the cache',
    'hit ratio → 0, database arrival rate jumps 5–10×, the pool and the primary become the bottleneck.',
  ],
  [
    'fire a flash spike',
    'retries push λ_eff > λ; the amplification factor and the recovery time are both measured.',
  ],
  [
    'shard a hot table',
    'per-shard load shows on sub-cards; a hot shard under a skewed key distribution is flagged.',
  ],
  [
    'ask “how many users until this breaks?”',
    'the system grade answers it — A–F, a headroom multiple, and “breaks around N”.',
  ],
];

/* --- tiny inline icons for the feature grid (1.6px stroke, 18px) --------- */
function svg(children: ReactNode) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
const IcoBox = () => svg(<><path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5v-7Z" /><path d="M3 6.5 10 10l7-3.5M10 10v7" /></>);
const IcoDb = () => svg(<><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></>);
const IcoWave = () => svg(<path d="M2 10c2 0 2-4 4-4s2 8 4 8 2-8 4-8 2 4 4 4" />);
const IcoWrench = () => svg(<path d="M14 3a4 4 0 0 0-5 5l-6 6 2 2 6-6a4 4 0 0 0 5-5l-2.5 2.5L12 9l-1.5-1.5L14 3Z" />);
const IcoInfo = () => svg(<><circle cx="10" cy="10" r="7.5" /><path d="M10 9v4M10 6.5h.01" /></>);
const IcoShare = () => svg(<><circle cx="5" cy="10" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="15" r="2" /><path d="M7 9l6-3M7 11l6 3" /></>);

const FEATURES: [ReactNode, string, string][] = [
  [
    <IcoBox key="i" />,
    'Real components',
    'Load balancer, app server (vCPU/RAM sizing, bounded queue, load shedding, autoscaling), cache, SQL database, queue, worker, CDN, object store, gateway, third-party service.',
  ],
  [
    <IcoDb key="i" />,
    'Database topologies',
    'Single, primary + read replicas, multi-primary, sharded — each instance’s load on its own sub-card, with hot-shard detection under skewed keys.',
  ],
  [
    <IcoWave key="i" />,
    'Load models',
    'Closed-loop (N users + think time, via the interactive response-time law) or open-loop target RPS. Constant, wander, ramp, diurnal, spike, thundering herd.',
  ],
  [
    <IcoWrench key="i" />,
    'Bottleneck detector',
    'Re-solves patched copies of your design to rank the cheapest fix that clears the SLO — one click to apply it and re-solve.',
  ],
  [
    <IcoInfo key="i" />,
    'Explain everything',
    'Hover any metric or control for the formula behind it and the term that dominates the result right now. A teaching aid as much as a sizing tool.',
  ],
  [
    <IcoShare key="i" />,
    'Share & export',
    'The whole design compresses into a URL. JSON import / export, canvas PNG / SVG, a markdown metrics report, and a seeded random-system generator.',
  ],
];

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav" data-scrolled={scrolled}>
        <div className="lp-wrap lp-nav-inner">
          <a className="lp-brand" href={BASE}>
            <span className="lp-logo" aria-hidden="true" />
            breakpoint
          </a>
          <nav className="lp-nav-links">
            <a href="#live">Live demo</a>
            <a href="#architecture">Architecture</a>
            <a href={WIKI}>Wiki</a>
            <a href={`${REPO}/blob/main/docs/model.md`}>The math</a>
            <a className="lp-btn lp-btn-sm" href={REPO}>
              GitHub ★
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="lp-hero">
          <div className="lp-wrap">
            <span className="lp-eyebrow">open source · runs in the browser · MIT</span>
            <h1>
              Find the <em>breakpoint</em> before production does.
            </h1>
            <p className="lp-lead">
              An interactive, quantitatively honest system-design sandbox. Compose an architecture
              on a canvas, run a traffic scenario, and watch real queueing-theory metrics —
              utilization, latency percentiles, drop rate, retry amplification — propagate through
              the graph in real time.
            </p>
            <div className="lp-cta-row">
              <a className="lp-btn lp-btn-primary" href={SANDBOX}>
                Open the sandbox →
              </a>
              <a className="lp-btn" href="#live">
                See it running
              </a>
            </div>
            <p className="lp-hero-note">
              no account · no install · your design never leaves the browser
            </p>
          </div>
        </section>

        {/* live demo — the real engine */}
        <section className="lp-section" id="live">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-kicker">§1 · The demonstration</span>
              <h2>The engine is running on this page right now.</h2>
              <p>
                Below is a real read-heavy web tier being solved ~8 times a second while a scripted
                load curve climbs from calm to a flash spike. The bars, the throughput split and
                the p99 line are the analytical solver’s actual output — the same code the sandbox
                runs.
              </p>
            </div>
            <LiveDemo />
          </div>
        </section>

        {/* watch what happens */}
        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-kicker">§2 · The premise</span>
              <h2>Change one thing. Watch the whole system respond.</h2>
              <p>
                Every number is emergent from editing the running graph — there are no scripted
                demos. Drag a node, flip a parameter, fire a spike; the system re-solves instantly.
              </p>
            </div>
            <div className="lp-whens">
              {WHENS.map(([act, res]) => (
                <div className="lp-when" key={act}>
                  <span className="lp-when-act">{act}</span>
                  <span className="lp-when-res">{res}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* architecture showcase */}
        {SHOWCASE && (
          <section className="lp-section" id="architecture">
            <div className="lp-wrap">
              <div className="lp-section-head">
                <span className="lp-kicker">§3 · A real design</span>
                <h2>A complete e-commerce checkout, wired end to end.</h2>
                <p>
                  CDN in front, a checkout service reading sessions from Redis, writing orders to
                  Postgres through a PgBouncer pool, calling Stripe (rate-limited, uncontrollable),
                  and enqueuing fulfilment for a worker pool. Open it and push traffic until Stripe
                  starts returning 429s.
                </p>
              </div>
              <div className="lp-arch">
                <div className="lp-arch-inner">
                  <MiniCanvas design={SHOWCASE} />
                </div>
                <div className="lp-arch-foot">
                  <p>
                    {SHOWCASE.nodes.length} components · {SHOWCASE.edges.length} links · the exact
                    graph the button hands to the canvas.
                  </p>
                  <a className="lp-btn lp-btn-primary lp-btn-sm" href={SHOWCASE_URL}>
                    Open in the canvas →
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* two engines */}
        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-kicker">§4 · Method</span>
              <h2>Every number is computed twice.</h2>
              <p>
                A visualizer is only worth trusting if the math is real. breakpoint runs two
                independent engines and checks that they agree — in CI, on every commit.
              </p>
            </div>
            <div className="lp-engines">
              <div className="lp-engine">
                <span className="lp-tag">closed form</span>
                <h3>Analytical solver</h3>
                <p>
                  M/M/1, M/M/c (Erlang C), M/M/c/K bounded queues, Erlang B/C, plus Jackson-network
                  flow equations for per-node arrival rates, retry fixed-point iteration, and
                  critical-path latency. Runs on every edit, instantly.
                </p>
              </div>
              <div className="lp-engine">
                <span className="lp-tag">seeded</span>
                <h3>Discrete-event simulation</h3>
                <p>
                  A binary-heap event queue, non-homogeneous Poisson arrivals, per-request routing
                  with fan-out / join, log-spaced latency histograms. Same seed + same design ⇒
                  identical run.
                </p>
              </div>
            </div>
            <div className="lp-agree">
              <span>analytical</span>
              <b>≈</b>
              <span>simulation</span>
              <span style={{ color: 'var(--lp-dim)' }}>
                — within tolerance for stationary load, asserted as a test.
              </span>
            </div>
          </div>
        </section>

        {/* in the box */}
        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <span className="lp-kicker">§5 · Apparatus</span>
              <h2>Enough to model a real system.</h2>
            </div>
            <div className="lp-grid">
              {FEATURES.map(([ico, title, body]) => (
                <div className="lp-card" key={title}>
                  <div className="lp-card-ico">{ico}</div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* final CTA */}
        <section className="lp-final">
          <div className="lp-wrap">
            <h2>Build a system. Watch it break.</h2>
            <p>
              Start from a template or a blank canvas. Everything runs locally in your browser —
              nothing to install, nothing to sign up for.
            </p>
            <div className="lp-cta-row">
              <a className="lp-btn lp-btn-primary" href={SANDBOX}>
                Open the sandbox →
              </a>
              <a className="lp-btn" href={REPO}>
                Star on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-row">
            <a className="lp-brand" href={BASE} style={{ fontSize: 14 }}>
              <span className="lp-logo" aria-hidden="true" />
              breakpoint
            </a>
            <a href={REPO}>GitHub</a>
            <a href={WIKI}>Wiki</a>
            <a href={`${REPO}#readme`}>Docs</a>
            <a href={`${REPO}/blob/main/docs/model.md`}>The math</a>
            <a href={SANDBOX}>Open the sandbox</a>
            <span style={{ marginLeft: 'auto' }}>MIT licensed</span>
          </div>
          <p className="lp-footer-note">
            A first-pass sizing sandbox and teaching aid — close enough to real queueing behaviour
            to build intuition, and honest about where the model stops being valid. Not affiliated
            with any vendor.
          </p>
        </div>
      </footer>
    </div>
  );
}
