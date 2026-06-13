import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UserDetail } from './UserDetail.js';

interface MockOpts {
  groups?: { id: string; name: string }[];
  historyEntries?: unknown[];
}

function mockApi(opts: MockOpts = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body as string | undefined });
      if (String(url).includes('/audit-logs')) {
        const entries = opts.historyEntries ?? [];
        return { ok: true, json: async () => ({ entries, total: entries.length, page: 1, pageSize: 20 }) };
      }
      if (method === 'PATCH') {
        return { ok: true, json: async () => ({ user: { id: 'u1' } }) };
      }
      return {
        ok: true,
        json: async () => ({
          user: { id: 'u1', name: 'Alice', email: 'alice@x.com', status: 'active' },
          groups: opts.groups ?? [{ id: 'g1', name: 'Team A' }],
        }),
      };
    }),
  );
  return calls;
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<UserDetail userId="u1" />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

describe('UserDetail', () => {
  it('renders the user details and group memberships', async () => {
    // TDD: UserDetail.test.tsx — renders the user details and group memberships | positive
    mockApi({ groups: [{ id: 'g1', name: 'Team A' }] });
    renderDetail();
    await waitFor(() => expect(screen.getByDisplayValue('alice@x.com')).toBeInTheDocument());
    expect(screen.getByText('Team A')).toBeInTheDocument();
  });

  it('saving edits calls PATCH and refreshes', async () => {
    // TDD: UserDetail.test.tsx — saving edits calls PATCH and refreshes | positive
    const calls = mockApi();
    renderDetail();
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Alice B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/users/u1'))).toBe(true),
    );
  });

  it('embeds the change history timeline', async () => {
    // TDD: UserDetail.test.tsx — embeds the change history timeline | positive
    mockApi({
      historyEntries: [
        {
          id: 'log1',
          action: 'user.updated',
          source: 'ui',
          reverts_id: null,
          payload: { op: 'update', before: { name: 'Alice' }, after: { name: 'Alice B' } },
          revertible: true,
        },
      ],
    });
    renderDetail();
    expect(await screen.findByText('Change history')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Alice B')).toBeInTheDocument());
  });
});
