/**
 * Public engine API. Nothing here imports React / DOM — the whole engine runs
 * happily in a Web Worker and under Vitest in `node`.
 */
export * from './types';
export { solve } from './solver';
export { analyze } from './analyze';
export type { Analysis, Bottleneck, Fix, Capacity } from './analyze';
export { buildGraph, topoOrder, expectedAttempts } from './flow';
export { mulberry32 } from './rng';
export type { Rng } from './rng';
export {
  getModel,
  hasModel,
  allModels,
  defaultParamsFor,
} from './registry';
export type {
  ComponentModel,
  RoutingMode,
  ComponentCategory,
  ComponentTier,
  ScaleParam,
} from './components/types';
export { tierOf, resolveScaleParam } from './components/types';
export * as queueing from './queueing';
