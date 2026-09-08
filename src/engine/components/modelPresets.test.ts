import { describe, expect, it } from 'vitest';
import { allModels } from '../registry';

/** Every model's standard-size presets must be real, schema-valid param bundles. */
describe('component size presets', () => {
  for (const model of allModels()) {
    const presets = model.presets;
    if (!presets?.length) continue;

    describe(model.type, () => {
      const knownKeys = new Set(Object.keys((model.paramSchema as { shape?: object }).shape ?? {}));

      for (const ps of presets) {
        it(`"${ps.label}" patches known keys and validates`, () => {
          for (const key of Object.keys(ps.patch)) {
            expect(knownKeys.has(key), `${key} is not a param of ${model.type}`).toBe(true);
          }
          const merged = { ...model.defaultParams, ...ps.patch };
          const parsed = model.paramSchema.parse(merged) as Record<string, unknown>;
          for (const [key, value] of Object.entries(ps.patch)) {
            expect(parsed[key]).toBe(value);
          }
        });
      }

      it('labels are unique', () => {
        const labels = presets.map((p) => p.label);
        expect(new Set(labels).size).toBe(labels.length);
      });
    });
  }
});
