import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { UserList } from './UserList.js';

function mockUsers(users: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ users, total: users.length, page: 1, pageSize: 20 }),
    })),
  );
}

function mockApiWithCalls(users: unknown[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (method === 'POST') return { ok: true, json: async () => ({ ok: true, user: { id: 'new' } }) };
      return { ok: true, json: async () => ({ users, total: users.length, page: 1, pageSize: 20 }) };
    }),
  );
  return calls;
}

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<UserList />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

const sample = [
  { id: 'u1', name: 'Alice', email: 'alice@x.com', status: 'active', created_at: '' },
  { id: 'u2', name: 'Bob', email: 'bob@x.com', status: 'inactive', created_at: '' },
];

describe('UserList', () => {
  it('renders users with correct status badges', async () => {
    // TDD: UserList.test.tsx — renders users with correct status badges | positive
    mockUsers(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());
    const badges = screen.getAllByTestId('status-badge');
    expect(badges.map((b) => b.textContent)).toEqual(['active', 'inactive']);
  });

  it('search input filters the displayed list', async () => {
    // TDD: UserList.test.tsx — search input filters the displayed list | positive
    mockUsers(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('bob@x.com')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Search'), 'alice');
    expect(screen.getByText('alice@x.com')).toBeInTheDocument();
    expect(screen.queryByText('bob@x.com')).not.toBeInTheDocument();
  });

  it('deactivate button opens confirmation modal', async () => {
    // TDD: UserList.test.tsx — deactivate button opens confirmation modal | positive
    mockUsers(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Deactivate alice@x.com?')).toBeInTheDocument();
  });

  it('New user button opens a create form and submits to the API', async () => {
    // TDD: UserList.test.tsx — New user button opens a create form and submits to the API | positive
    const calls = mockApiWithCalls(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Carol');
    await userEvent.type(screen.getByLabelText('Email'), 'carol@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'supersecret');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/admin/users'))).toBe(true),
    );
  });

  it('confirming deactivate calls the deactivate endpoint', async () => {
    // TDD: UserList.test.tsx — confirming deactivate calls the deactivate endpoint | positive
    const calls = mockApiWithCalls(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('alice@x.com')).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/u1/deactivate'))).toBe(true),
    );
  });

  it('an inactive user shows Reactivate and confirming calls the reactivate endpoint', async () => {
    // TDD: UserList.test.tsx — inactive user shows Reactivate and confirming calls reactivate | positive
    const calls = mockApiWithCalls(sample);
    renderList();
    await waitFor(() => expect(screen.getByText('bob@x.com')).toBeInTheDocument());

    // bob (u2) is inactive in the sample
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/u2/reactivate'))).toBe(true),
    );
  });
});
