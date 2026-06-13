import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportExport } from './ImportExport.js';

const emptyEntity = { created: 0, skipped: 0, errors: [] };

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('/export')) {
        return {
          ok: true,
          json: async () => ({
            users: 'name,email,status\nA,a@x.com,active',
            groups: '',
            roles: '',
            group_members: '',
            group_roles: '',
            role_permissions: '',
          }),
        };
      }
      // import
      return {
        ok: true,
        json: async () => ({
          report: {
            users: { created: 2, skipped: 1, errors: [] },
            groups: emptyEntity,
            roles: emptyEntity,
            group_members: emptyEntity,
            group_roles: emptyEntity,
            role_permissions: emptyEntity,
          },
          tempPasswords: [{ email: 'new@x.com', password: 'Secret123' }],
        }),
      };
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ImportExport', () => {
  it('export downloads the CSV bundle', async () => {
    // TDD: ImportExport.test.tsx — export downloads the CSV bundle | positive
    mockApi();
    render(<ImportExport />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const link = await screen.findByText('users.csv');
    expect(link).toHaveAttribute('download', 'users.csv');
  });

  it('import uploads files and renders created/skipped/errors summary', async () => {
    // TDD: ImportExport.test.tsx — import uploads files and renders created/skipped/errors summary | positive
    mockApi();
    render(<ImportExport />);
    const file = new File(['name,email,status\nNew,new@x.com,active'], 'users.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('users'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByTestId('report')).toBeInTheDocument());
    expect(screen.getByText(/users: created 2, skipped 1, errors 0/)).toBeInTheDocument();
  });

  it('temp passwords for new users are shown once', async () => {
    // TDD: ImportExport.test.tsx — temp passwords for new users are shown once | positive
    mockApi();
    render(<ImportExport />);
    const file = new File(['name,email,status\nNew,new@x.com,active'], 'users.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('users'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    const box = await screen.findByTestId('temp-passwords');
    expect(box).toHaveTextContent('new@x.com: Secret123');
  });
});
