import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GroupDetail } from './GroupDetail.js';

interface Member { id: string; name: string | null; email: string; status: string }

function mockApi(initialMembers: Member[]) {
  const members = [...initialMembers];
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (method === 'DELETE') {
        const id = String(url).split('/').pop();
        const idx = members.findIndex((m) => m.id === id);
        if (idx >= 0) members.splice(idx, 1);
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
      return {
        ok: true,
        json: async () => ({
          group: { id: 'g1', name: 'Team A', description: null },
          members: [...members],
          roles: [{ id: 'r1', name: 'Editor' }],
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
  return render(<GroupDetail groupId="g1" />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

const sample: Member[] = [
  { id: 'u1', name: 'Alice', email: 'alice@x.com', status: 'active' },
  { id: 'u2', name: 'Bob', email: 'bob@x.com', status: 'active' },
];

describe('GroupDetail', () => {
  it('renders group members list', async () => {
    // TDD: GroupDetail.test.tsx — renders group members list | positive
    mockApi(sample);
    renderDetail();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());
    expect(screen.getByText('bob@x.com')).toBeInTheDocument();
  });

  it('removing a member calls the API and updates the list', async () => {
    // TDD: GroupDetail.test.tsx — removing a member calls the API and updates the list | positive
    const calls = mockApi(sample);
    renderDetail();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    await waitFor(() => expect(screen.queryByText('alice@x.com')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/groups/g1/members/u1'))).toBe(true);
  });

  it('assigning a role to the group calls the correct endpoint', async () => {
    // TDD: GroupDetail.test.tsx — assigning a role to the group calls the correct endpoint | positive
    const calls = mockApi(sample);
    renderDetail();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Role ID'), 'role-9');
    await userEvent.click(screen.getByRole('button', { name: 'Assign role' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/groups/g1/roles'))).toBe(true),
    );
  });
});
