import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUsers } from './useUsers.js';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useUsers', () => {
  it('fetches paginated user list', async () => {
    // TDD: useUsers.test.ts — fetches paginated user list | positive
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          users: [{ id: 'u1', name: 'A', email: 'a@x.com', status: 'active', created_at: '' }],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      })),
    );
    const { result } = renderHook(() => useUsers(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.users).toHaveLength(1);
    expect(result.current.data?.total).toBe(1);
  });

  it('filters by group_id param', async () => {
    // TDD: useUsers.test.ts — filters by group_id param | positive
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      json: async () => ({ users: [], total: 0, page: 1, pageSize: 20 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useUsers({ group: 'g1' }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0][0])).toContain('group=g1');
  });
});
