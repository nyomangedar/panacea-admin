import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { CreateEntityModal } from './CreateEntityModal.js';

function mockApi() {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string });
      return { ok: true, json: async () => ({ ok: true }) };
    }),
  );
  return calls;
}

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <CreateEntityModal
      open
      onClose={() => {}}
      title="New group"
      endpoint="/api/admin/groups"
      invalidateKey={['admin', 'groups']}
    />,
    { wrapper: Wrapper },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CreateEntityModal', () => {
  it('submits the name to the create endpoint', async () => {
    // TDD: CreateEntityModal.test.tsx — submits the name to the create endpoint | positive
    const calls = mockApi();
    renderModal();
    await userEvent.type(screen.getByLabelText('Name'), 'Team X');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith('/api/admin/groups') && c.body?.includes('Team X'),
        ),
      ).toBe(true),
    );
  });

  it('disables Create until a name is entered', async () => {
    // TDD: CreateEntityModal.test.tsx — disables Create until a name is entered | negative
    mockApi();
    renderModal();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name'), 'X');
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });
});
