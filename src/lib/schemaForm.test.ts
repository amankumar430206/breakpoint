import { describe, expect, it } from 'vitest';
import { prettyLabel } from './schemaForm';

describe('prettyLabel', () => {
  it('splits camelCase and appends a unit', () => {
    expect(prettyLabel('serviceTimeMs')).toBe('Service time (ms)');
    expect(prettyLabel('queryTimeMs')).toBe('Query time (ms)');
    expect(prettyLabel('capacityRps')).toBe('Capacity (rps)');
    expect(prettyLabel('queueLimit')).toBe('Queue limit');
    expect(prettyLabel('readReplicas')).toBe('Read replicas');
    expect(prettyLabel('loadShedding')).toBe('Load shedding');
    expect(prettyLabel('keyDistribution')).toBe('Key distribution');
  });

  it('uppercases known acronyms', () => {
    expect(prettyLabel('ramGB')).toBe('RAM (GB)');
    expect(prettyLabel('storageGB')).toBe('Storage (GB)');
    expect(prettyLabel('vcpus')).toBe('vCPUs');
  });

  it('uses hand-written overrides where the algorithm reads badly', () => {
    expect(prettyLabel('memPerReqMB')).toBe('Memory / request (MB)');
    expect(prettyLabel('crossShardPct')).toBe('Cross-shard queries (%)');
    expect(prettyLabel('targetUtil')).toBe('Target utilization');
  });
});
