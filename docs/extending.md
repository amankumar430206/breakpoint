# Adding a component

A component is **one file + one registry line + one docs row**. The canvas node,
the inspector form, presets chips, and the DES station are all generic — they
read your `ComponentModel`.

## 1. The file — `src/engine/components/myThing.ts`

```ts
import { z } from 'zod';
import { mm1 } from '../queueing';
import { metricsFromQueue, addLatency } from './util';
import { num, type ComponentModel } from './types';

export const myThingModel: ComponentModel = {
  type: 'myThing',                 // add to ComponentType in engine/types.ts
  label: 'My Thing',
  category: 'compute',             // source|compute|data|network|messaging|resilience|external
  routing: 'passthrough',          // passthrough | replicate | branch | sink
  handles: { in: true, out: true },

  defaultParams: { capacityRps: 10_000, latencyMs: 5 },
  paramSchema: z.object({
    capacityRps: z.number().positive().max(1e7).default(10_000),
    latencyMs: z.number().nonnegative().default(5),
  }),
  paramDocs: {
    capacityRps: 'Requests/sec one instance serves before it saturates.',
    latencyMs: 'Fixed processing latency added to every request.',
  },

  // optional: quick-pick chips above the sliders
  presetLegend: 'throughput (req/s)',
  presets: [{ label: '10k', hint: 'small box', patch: { capacityRps: 10_000 } }],

  // fraction of inflow that continues downstream (1 for passthrough, 0 for sink,
  // 1 − hitRatio for a cache …). ctx.downstreamFailure is available if you need it.
  outflowFraction: () => 1,

  // analytical steady-state solve for one node
  solve: ({ params, inflow, downstreamErrorRate }) => {
    const cap = num(params, 'capacityRps', 10_000);
    const base = metricsFromQueue(mm1(inflow, cap), {
      offered: inflow, capacity: cap, servers: 1,
      intrinsicErrorRate: 0, downstreamErrorRate,
    });
    return {
      metrics: addLatency(base, num(params, 'latencyMs', 5) / 1000),
      explain: [{ metric: 'rho', text: `ρ = λ / capacityRps = ${base.rho.toFixed(3)}.` }],
    };
  },

  // single-station spec for the discrete-event simulator — SAME params
  simSpec: (params) => ({
    servers: 1,
    serviceRate: num(params, 'capacityRps', 10_000),
    queueCap: Infinity,
    fixedLatencySec: num(params, 'latencyMs', 5) / 1000,
    errorRate: 0,
    branchProb: 1,
  }),
};
```

## 2. Register it — `src/engine/registry.ts`

```ts
import { myThingModel } from './components/myThing';
// …add myThingModel to the array in the for-of loop
```

That's it for wiring. The palette, inspector, canvas node, and worker pick it up
from the registry. If the type needs a canvas icon, add a `case` in
`src/flow/icons.tsx` and a `nodeTypes` entry in `src/flow/Canvas.tsx`.

## 3. Test it — `src/engine/components/myThing.test.ts`

- assert the analytical `solve()` against a hand-computed value at a known load;
- add a case to `src/engine/des/convergence.test.ts` if the component introduces
  a **new mechanic** — the DES and analytical numbers must agree for stationary
  input (that is the credibility contract).

```bash
npm run typecheck && npm test && npm run build
```

## 4. Document it

One row in [`components.md`](components.md); if it introduces a formula, a short
section in [`model.md`](model.md) with a citation.

## Optional hooks

| field | use |
| --- | --- |
| `scaleParam` | the `±` stepper on the node card (e.g. `replicas`). A function form can depend on other params. |
| `fieldVisible(key, params)` | hide inspector fields that don't apply to the current mode (e.g. `poolSize` only for pool engines). |
| `presets` / `presetLegend` | standard-shape quick-pick chips above the sliders. |
| composite `metrics.members[]` | per-instance breakdown (DB replicas, shards) — the node draws one sub-row each. |
