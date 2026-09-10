import { describe, expect, it } from 'vitest';
import {
  clampConfig,
  DEFAULT_PROBE_CONFIG,
  isAllowedTarget,
  isLoopbackOrPrivateHost,
  MAX_DURATION_SEC,
  MAX_RPS,
  MAX_USERS,
  projectedRequestCount,
} from './targetPolicy';

describe('isLoopbackOrPrivateHost', () => {
  it('allows loopback + local hostnames', () => {
    for (const h of ['localhost', 'ip6-localhost', 'api.localhost', 'db.local', '127.0.0.1', '127.9.9.9', '::1']) {
      expect(isLoopbackOrPrivateHost(h)).toBe(true);
    }
  });

  it('allows RFC1918 IPv4 and IPv6 ULA', () => {
    for (const h of ['10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254', 'fd00::1', 'fc00::abcd']) {
      expect(isLoopbackOrPrivateHost(h)).toBe(true);
    }
  });

  it('refuses public hosts, link-local, and the metadata IP', () => {
    for (const h of ['example.com', '8.8.8.8', '1.2.3.4', '169.254.169.254', '172.15.0.1', '172.32.0.1', 'fe80::1']) {
      expect(isLoopbackOrPrivateHost(h)).toBe(false);
    }
  });
});

describe('isAllowedTarget', () => {
  it('accepts a localhost URL with a path and port', () => {
    const r = isAllowedTarget('http://localhost:3000/api/health');
    expect(r.ok).toBe(true);
    expect(r.url?.hostname).toBe('localhost');
  });

  it('rejects a malformed URL', () => {
    expect(isAllowedTarget('not a url').ok).toBe(false);
    expect(isAllowedTarget('localhost:3000').ok).toBe(false); // no scheme
  });

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedTarget('ws://localhost:3000').ok).toBe(false);
    expect(isAllowedTarget('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects public hosts with a sidecar hint', () => {
    const r = isAllowedTarget('https://api.stripe.com/v1/charges');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sidecar/i);
  });
});

describe('clampConfig', () => {
  it('clamps every field to the hard ceilings', () => {
    const c = clampConfig({
      mode: 'rps',
      targetRps: 999_999,
      users: 5_000,
      thinkTimeSec: -3,
      durationSec: 10_000,
      timeoutMs: 999_999,
    });
    expect(c.targetRps).toBe(MAX_RPS);
    expect(c.users).toBe(MAX_USERS);
    expect(c.durationSec).toBe(MAX_DURATION_SEC);
    expect(c.thinkTimeSec).toBe(0);
    expect(c.timeoutMs).toBeLessThanOrEqual(60_000);
  });

  it('leaves an in-range config untouched', () => {
    expect(clampConfig(DEFAULT_PROBE_CONFIG)).toEqual(DEFAULT_PROBE_CONFIG);
  });
});

describe('projectedRequestCount', () => {
  it('rps mode = rate × duration', () => {
    expect(projectedRequestCount({ ...DEFAULT_PROBE_CONFIG, mode: 'rps', targetRps: 100, durationSec: 30 })).toBe(3000);
  });

  it('users mode scales with population and inverse think time', () => {
    const n = projectedRequestCount({
      ...DEFAULT_PROBE_CONFIG,
      mode: 'users',
      users: 10,
      thinkTimeSec: 1,
      durationSec: 30,
    });
    expect(n).toBe(300);
  });
});
