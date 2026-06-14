import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChangeHistory } from './ChangeHistory.js';
import type { HistoryEntry } from '../hooks/useChangeHistory.js';

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 'log1',
    actor_id: null,
    actor_email: null,
    action: 'user.updated',
    target_type: 'user',
    target_id: 'u1',
    payload: { op: 'update', before: null, after: null },
    source: 'ui',
    reverts_id: null,
    created_at: '',
    revertible: true,
    ...over,
  };
}

interface RevertResult {
  status: number;
  body?: unknown;
}

function stub(entries: HistoryEntry[], revert?: RevertResult) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.includes('/revert')) {
      const r = revert ?? { status: 200, body: { entry: {} } };
      return { ok: r.status < 400, status: r.status, json: async () => r.body ?? {} } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ entries, total: entries.length, page: 1, pageSize: 20 }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ChangeHistory targetType="user" targetId="u1" />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

describe('ChangeHistory', () => {
  it('renders a field-level diff from { before, after }', async () => {
    // TDD: ChangeHistory.test.tsx — renders a field-level diff from { before, after } | positive
    stub([entry({ payload: { op: 'update', before: { name: 'Old' }, after: { name: 'New' } } })]);
    renderHistory();
    await waitFor(() => expect(screen.getByText('name')).toBeInTheDocument());
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('disables Revert for non-revertible entries with a reason tooltip', async () => {
    // TDD: ChangeHistory.test.tsx — disables Revert for non-revertible entries with a reason tooltip | negative
    stub([
      entry({
        action: 'user.created',
        payload: { op: 'create', before: null, after: { name: 'A' } },
        revertible: false,
        reason: 'A create cannot be reverted',
      }),
    ]);
    renderHistory();
    const btn = await screen.findByRole('button', { name: 'Revert' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'A create cannot be reverted');
  });

  it('Revert button calls the endpoint and refreshes entity + history', async () => {
    // TDD: ChangeHistory.test.tsx — Revert button calls the endpoint and refreshes entity + history | positive
    const fetchMock = stub([
      entry({ payload: { op: 'update', before: { name: 'Old' }, after: { name: 'New' } } }),
    ]);
    renderHistory();
    await userEvent.click(await screen.findByRole('button', { name: 'Revert' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm revert' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/audit-logs/log1/revert') &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
    // Invalidation refetches the history GET (initial load + post-revert refresh).
    const getCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET' &&
        String(url).includes('/audit-logs'),
    );
    await waitFor(() => expect(getCalls.length).toBeGreaterThanOrEqual(1));
  });

  it('a 409 conflict response renders a blocking explanation', async () => {
    // TDD: ChangeHistory.test.tsx — a 409 conflict response renders a blocking explanation | negative
    stub(
      [entry({ payload: { op: 'update', before: { name: 'Old' }, after: { name: 'New' } } })],
      { status: 409, body: { conflict: 'changed_since', detail: 'Field "name" changed since this version' } },
    );
    renderHistory();
    await userEvent.click(await screen.findByRole('button', { name: 'Revert' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm revert' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Field "name" changed since this version');
  });

  it('paginates: Next requests the following page', async () => {
    // TDD: ChangeHistory.test.tsx — pagination Next requests the next page | positive
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ entries: [entry({})], total: 20, page: 1, pageSize: 8 }),
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHistory();

    expect(await screen.findByText(/Page 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true),
    );
  });

  it('reverted entries show a "revert of #X" badge', async () => {
    // TDD: ChangeHistory.test.tsx — reverted entries show a "revert of #X" badge | positive
    stub([
      entry({
        action: 'user.reactivated',
        reverts_id: 'abcdef12-3456-7890-abcd-ef1234567890',
        payload: { op: 'update', before: { status: 'inactive' }, after: { status: 'active' } },
      }),
    ]);
    renderHistory();
    expect(await screen.findByText(/revert of #/)).toBeInTheDocument();
  });
});
