import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RoleAccessConfig } from './RoleAccessConfig.js';

const tree = {
  modules: [
    {
      module: 'admin',
      access: { id: 'pa', key: 'admin:access', label: 'Access Admin' },
      functions: [],
      pages: [
        {
          page: 'Users',
          access: { id: 'pu', key: 'admin:users:access', label: 'Users page' },
          functions: [{ id: 'pc', key: 'admin:users:create', label: 'Create user' }],
        },
      ],
    },
  ],
};

function mockApi(grantedKeys: string[]) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (String(url).includes('/permissions')) return { ok: true, json: async () => tree };
      if (String(url).includes('/roles') && method === 'GET') {
        return { ok: true, json: async () => ({ roles: [{ id: 'r1', name: 'R', permissions: grantedKeys }] }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }),
  );
  return calls;
}

function renderConfig() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<RoleAccessConfig roleId="r1" />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

const allGranted = ['admin:access', 'admin:users:access', 'admin:users:create'];

describe('RoleAccessConfig', () => {
  it('renders the module → page → function tree from GET /permissions', async () => {
    // TDD: RoleAccessConfig.test.tsx — renders the module → page → function tree | positive
    mockApi(allGranted);
    renderConfig();
    await waitFor(() => expect(screen.getByLabelText('Access Admin')).toBeInTheDocument());
    expect(screen.getByLabelText('Users page')).toBeInTheDocument();
    expect(screen.getByLabelText('Create user')).toBeInTheDocument();
  });

  it('staged toggles are not sent until Save + Confirm', async () => {
    // TDD: RoleAccessConfig.test.tsx — toggling a function-level permission calls assign/remove endpoint | positive
    const calls = mockApi(allGranted);
    renderConfig();
    await waitFor(() => expect(screen.getByLabelText('Create user')).toBeInTheDocument());

    // currently granted → toggling off stages a removal but sends nothing yet
    await userEvent.click(screen.getByLabelText('Create user'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    // Save opens a confirmation listing the change; Confirm commits it (DELETE by permission id)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke:')).toBeInTheDocument();
    expect(within(dialog).getByText('Create user')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/roles/r1/permissions/pc'))).toBe(true),
    );
  });

  it('Save changes is disabled until something is toggled', async () => {
    // TDD: RoleAccessConfig.test.tsx — Save changes is disabled with no pending changes | negative
    mockApi(allGranted);
    renderConfig();
    await waitFor(() => expect(screen.getByLabelText('Create user')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Create user'));
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('toggling a module/page access off disables its child toggles', async () => {
    // TDD: RoleAccessConfig.test.tsx — toggling a module/page access off disables its children | positive
    mockApi(allGranted);
    renderConfig();
    await waitFor(() => expect(screen.getByLabelText('Create user')).toBeInTheDocument());
    expect(screen.getByLabelText('Create user')).not.toBeDisabled();

    await userEvent.click(screen.getByLabelText('Users page')); // turn page access off
    expect(screen.getByLabelText('Create user')).toBeDisabled();
  });
});
