import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@panacea/ui';
import { apiGet } from './api.js';
import { UserList } from './pages/UserList.js';
import { AuditLog } from './pages/AuditLog.js';
import { ImportExport } from './pages/ImportExport.js';
import { GroupDetail } from './pages/GroupDetail.js';
import { RoleAccessConfig } from './pages/RoleAccessConfig.js';

type View = 'users' | 'groups' | 'roles' | 'audit' | 'data';

const NAV: { key: View; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'roles', label: 'Roles' },
  { key: 'audit', label: 'Audit log' },
  { key: 'data', label: 'Import / Export' },
];

function GroupsView() {
  const { data } = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => apiGet<{ groups: { id: string; name: string }[] }>('/api/admin/groups'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Back to groups
        </Button>
        <GroupDetail groupId={selected} />
      </div>
    );
  }
  return (
    <ul>
      {(data?.groups ?? []).map((g) => (
        <li key={g.id}>
          <Button variant="ghost" size="sm" onClick={() => setSelected(g.id)}>
            {g.name}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function RolesView() {
  const { data } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<{ roles: { id: string; name: string }[] }>('/api/admin/roles'),
  });
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Back to roles
        </Button>
        <RoleAccessConfig roleId={selected} />
      </div>
    );
  }
  return (
    <ul>
      {(data?.roles ?? []).map((r) => (
        <li key={r.id}>
          <Button variant="ghost" size="sm" onClick={() => setSelected(r.id)}>
            {r.name}
          </Button>
        </li>
      ))}
    </ul>
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
        {view === 'users' && <UserList />}
        {view === 'groups' && <GroupsView />}
        {view === 'roles' && <RolesView />}
        {view === 'audit' && <AuditLog />}
        {view === 'data' && <ImportExport />}
      </div>
    </div>
  );
}

export default Admin;
