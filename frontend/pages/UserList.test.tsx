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
});
