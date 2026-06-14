import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Breadcrumb } from '@panacea/ui';
import { apiGet } from './api.js';
import { UserList } from './pages/UserList.js';
import { UserDetail } from './pages/UserDetail.js';
import { AuditLog } from './pages/AuditLog.js';
import { ImportExport } from './pages/ImportExport.js';
import { GroupDetail } from './pages/GroupDetail.js';
import { RoleAccessConfig } from './pages/RoleAccessConfig.js';
import { CreateEntityModal } from './components/CreateEntityModal.js';

type View = 'users' | 'groups' | 'roles' | 'audit' | 'data';

const NAV: { key: View; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'roles', label: 'Roles' },
  { key: 'audit', label: 'Audit log' },
  { key: 'data', label: 'Import / Export' },
];

function UsersView() {
  const [selected, setSelected] = useState<{ id: string; label: string } | null>(null);
  if (selected) {
    return (
      <div>
        <Breadcrumb
          items={[{ label: 'Users', onClick: () => setSelected(null) }, { label: selected.label }]}
        />
        <UserDetail userId={selected.id} />
      </div>
    );
  }
  return <UserList onOpen={(id, label) => setSelected({ id, label })} />;
}

function GroupsView() {
  const { data } = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => apiGet<{ groups: { id: string; name: string }[] }>('/api/admin/groups'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (selected) {
    const name = (data?.groups ?? []).find((g) => g.id === selected)?.name ?? 'Group';
    return (
      <div>
        <Breadcrumb items={[{ label: 'Groups', onClick: () => setSelected(null) }, { label: name }]} />
        <GroupDetail groupId={selected} />
      </div>
    );
  }
  return (
    <div>
      <Button size="sm" onClick={() => setCreating(true)}>
        New group
      </Button>
      <ul>
        {(data?.groups ?? []).map((g) => (
          <li key={g.id}>
            <Button variant="ghost" size="sm" onClick={() => setSelected(g.id)}>
              {g.name}
            </Button>
          </li>
        ))}
      </ul>
      <CreateEntityModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New group"
        endpoint="/api/admin/groups"
        invalidateKey={['admin', 'groups']}
      />
    </div>
  );
}

function RolesView() {
  const { data } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<{ roles: { id: string; name: string }[] }>('/api/admin/roles'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (selected) {
    const name = (data?.roles ?? []).find((r) => r.id === selected)?.name ?? 'Role';
    return (
      <div>
        <Breadcrumb items={[{ label: 'Roles', onClick: () => setSelected(null) }, { label: name }]} />
        <RoleAccessConfig roleId={selected} />
      </div>
    );
  }
  return (
    <div>
      <Button size="sm" onClick={() => setCreating(true)}>
        New role
      </Button>
      <ul>
        {(data?.roles ?? []).map((r) => (
          <li key={r.id}>
            <Button variant="ghost" size="sm" onClick={() => setSelected(r.id)}>
              {r.name}
            </Button>
          </li>
        ))}
      </ul>
      <CreateEntityModal
        open={creating}
        onClose={() => setCreating(false)}
        title="New role"
        endpoint="/api/admin/roles"
        invalidateKey={['admin', 'roles']}
      />
    </div>
  );
}

export function Admin() {
  const [view, setView] = useState<View>('users');
  return (
    <div style={{ display: 'flex', gap: 16, padding: 16 }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
        {NAV.map((n) => (
          <Button
            key={n.key}
            variant={view === n.key ? 'primary' : 'ghost'}
            size="sm"
            aria-current={view === n.key}
            onClick={() => setView(n.key)}
          >
            {n.label}
          </Button>
        ))}
      </nav>
      <div style={{ flex: 1 }}>
        {view === 'users' && <UsersView />}
        {view === 'groups' && <GroupsView />}
        {view === 'roles' && <RolesView />}
        {view === 'audit' && <AuditLog />}
        {view === 'data' && <ImportExport />}
      </div>
    </div>
  );
}

export default Admin;
