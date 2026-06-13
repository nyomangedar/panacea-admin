import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuditLog } from './AuditLog.js';

function mockAudit() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(String(url), 'http://t');
      const source = u.searchParams.get('source');
      const page = Number(u.searchParams.get('page') ?? '1');
      let entries = [
        { id: 'a1', actor_email: 'admin@x.com', action: 'user.created', target_type: 'user', target_id: 'u1', source: 'ui', created_at: '2026-06-10', payload: { op: 'create' } },
        { id: 'a2', actor_email: 'admin@x.com', action: 'group.updated', target_type: 'group', target_id: 'g1', source: 'import', created_at: '2026-06-10', payload: { op: 'update' } },
      ];
      if (source) entries = entries.filter((e) => e.source === source);
      if (page === 2) {
        entries = [{ id: 'a3', actor_email: 'admin@x.com', action: 'role.created', target_type: 'role', target_id: 'r1', source: 'ui', created_at: '2026-06-11', payload: { op: 'create' } }];
      }
      return { ok: true, json: async () => ({ entries, total: 5, page, pageSize: 20 }) };
    }),
  );
}

function renderAudit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<AuditLog />, { wrapper: Wrapper });
}

afterEach(() => vi.unstubAllGlobals());

describe('AuditLog', () => {
  it('renders log entries with actor name, action, and source', async () => {
    // TDD: AuditLog.test.tsx — renders log entries with actor name, action, and source | positive
    mockAudit();
    renderAudit();
    await waitFor(() => expect(screen.getByText('user.created')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(table.getAllByText('admin@x.com').length).toBeGreaterThan(0);
    expect(table.getByText('import')).toBeInTheDocument();
    expect(table.getByText('group.updated')).toBeInTheDocument();
  });

  it("filtering by source='import' shows only imported-object entries", async () => {
    // TDD: AuditLog.test.tsx — filtering by source='import' shows only imported-object entries | positive
    mockAudit();
    renderAudit();
    await waitFor(() => expect(screen.getByText('user.created')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Source filter'), 'import');

    await waitFor(() => expect(screen.queryByText('user.created')).not.toBeInTheDocument());
    expect(screen.getByText('group.updated')).toBeInTheDocument();
  });

  it('expanding a row shows the payload detail', async () => {
    // TDD: AuditLog.test.tsx — expanding a row shows the payload detail | positive
    mockAudit();
    renderAudit();
    await waitFor(() => expect(screen.getByText('user.created')).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    expect(screen.getByTestId('payload')).toHaveTextContent('"op":"create"');
  });

  it('pagination controls load the next page', async () => {
    // TDD: AuditLog.test.tsx — pagination controls load the next page | positive
    mockAudit();
    renderAudit();
    await waitFor(() => expect(screen.getByText('user.created')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('role.created')).toBeInTheDocument());
  });
});
