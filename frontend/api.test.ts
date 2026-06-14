import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiPost } from './api.js';

function stubFetch() {
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ({ ok: true, json: async () => ({}) }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiPost', () => {
  it('omits the JSON content-type for a bodyless POST (deactivate)', async () => {
    // TDD: api.test.ts — bodyless POST sends no JSON content-type so Fastify accepts it | positive
    const fetchMock = stubFetch();
    await apiPost('/api/admin/users/u1/deactivate');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('sends a JSON content-type and body when a body is provided', async () => {
    // TDD: api.test.ts — POST with a body sets application/json and serializes it | positive
    const fetchMock = stubFetch();
    await apiPost('/api/admin/users', { email: 'x@y.com' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'x@y.com' }));
  });
});
