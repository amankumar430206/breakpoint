import { describe, expect, it } from 'vitest';
import { looksLikeCurl, parseCurl } from './curl';

describe('looksLikeCurl', () => {
  it('matches a curl command, not a URL', () => {
    expect(looksLikeCurl("curl 'http://x'")).toBe(true);
    expect(looksLikeCurl('  CURL http://x')).toBe(true);
    expect(looksLikeCurl('http://localhost:3000')).toBe(false);
  });
});

describe('parseCurl', () => {
  it('returns null for a non-curl string', () => {
    expect(parseCurl('http://localhost:3000')).toBeNull();
  });

  it('bare url → GET', () => {
    expect(parseCurl('curl http://localhost:3000/health')).toEqual({
      url: 'http://localhost:3000/health',
      method: 'GET',
    });
  });

  it('parses method, headers and JSON body with line continuations', () => {
    const cmd = `curl 'https://api.example.com/v1/orders' \\
      -X POST \\
      -H 'Content-Type: application/json' \\
      -H 'Authorization: Bearer abc123' \\
      --data-raw '{"item":"widget","qty":3}'`;
    const r = parseCurl(cmd)!;
    expect(r.url).toBe('https://api.example.com/v1/orders');
    expect(r.method).toBe('POST');
    expect(r.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer abc123'],
    ]);
    expect(r.body).toBe('{"item":"widget","qty":3}');
  });

  it('-d without -X implies POST', () => {
    const r = parseCurl(`curl http://localhost:8080/api -d 'a=1&b=2'`)!;
    expect(r.method).toBe('POST');
    expect(r.body).toBe('a=1&b=2');
  });

  it('-u becomes a Basic auth header', () => {
    const r = parseCurl(`curl -u alice:secret http://localhost:9000/`)!;
    expect(r.headers).toEqual([['Authorization', `Basic ${btoa('alice:secret')}`]]);
  });

  it('ignores cosmetic flags and honours --url / --compressed', () => {
    const r = parseCurl(`curl -sSL --compressed --url 'http://localhost:3000/x' -H 'X-A: 1'`)!;
    expect(r.url).toBe('http://localhost:3000/x');
    expect(r.headers).toEqual([['X-A', '1']]);
    expect(r.method).toBe('GET');
  });
});
