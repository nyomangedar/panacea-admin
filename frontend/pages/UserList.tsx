import { useState } from 'react';
import { Button, Input, Modal } from '@panacea/ui';
import { useUsers, type AdminUser } from '../hooks/useUsers.js';

export function UserList() {
  const { data, isLoading } = useUsers();
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<AdminUser | null>(null);

  const q = search.toLowerCase();
  const users = (data?.users ?? []).filter(
    (u) => (u.name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  );

  return (
    <div className="user-list">
      <Input label="Search" value={search} onChange={setSearch} placeholder="Search users" />

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
                <td>{u.email}</td>
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
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Deactivate user"
        description={confirm ? `Deactivate ${confirm.email}?` : ''}
        footer={
          <Button variant="danger" onClick={() => setConfirm(null)}>
            Confirm
          </Button>
        }
      />
    </div>
  );
}
