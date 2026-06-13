import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '@panacea/ui';
import { useUsers, type AdminUser } from '../hooks/useUsers.js';
import { apiPost } from '../api.js';

const emptyForm = { name: '', email: '', password: '' };

export function UserList({ onOpen }: { onOpen?: (id: string) => void } = {}) {
  const { data, isLoading } = useUsers();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });

  const createUser = useMutation({
    mutationFn: () => apiPost('/api/admin/users', form),
    onSuccess: () => {
      refresh();
      setCreating(false);
      setForm(emptyForm);
      setCreateError(null);
    },
    onError: () => setCreateError('Could not create user — the email may already exist.'),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => apiPost(`/api/admin/users/${id}/deactivate`),
    onSuccess: () => {
      refresh();
      setConfirm(null);
    },
  });

  const q = search.toLowerCase();
  const users = (data?.users ?? []).filter(
    (u) => (u.name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  );

  return (
    <div className="user-list">
      <div className="user-list-header" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Input label="Search" value={search} onChange={setSearch} placeholder="Search users" />
        <Button onClick={() => setCreating(true)}>New user</Button>
      </div>

      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>
                  {onOpen ? (
                    <Button variant="ghost" size="sm" onClick={() => onOpen(u.id)}>
                      {u.email}
                    </Button>
                  ) : (
                    u.email
                  )}
                </td>
                <td>
                  <span className={`badge badge-${u.status}`} data-testid="status-badge">
                    {u.status}
                  </span>
                </td>
                <td>
                  <Button variant="danger" size="sm" onClick={() => setConfirm(u)}>
                    Deactivate
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New user"
        footer={
          <Button loading={createUser.isPending} onClick={() => createUser.mutate()}>
            Create
          </Button>
        }
      >
        <Input label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <Input label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
        />
        {createError && (
          <div role="alert" className="create-error">
            {createError}
          </div>
        )}
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Deactivate user"
        description={confirm ? `Deactivate ${confirm.email}?` : ''}
        footer={
          <Button
            variant="danger"
            loading={deactivate.isPending}
            onClick={() => confirm && deactivate.mutate(confirm.id)}
          >
            Confirm
          </Button>
        }
      />
    </div>
  );
}
