import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card } from '@panacea/ui';
import { apiGet, apiPost, apiDelete } from '../api.js';
import { ChangeHistory } from '../components/ChangeHistory.js';

interface Member {
  id: string;
  name: string | null;
  email: string;
  status: string;
}
interface Role {
  id: string;
  name: string;
}
interface GroupDetailData {
  group: { id: string; name: string; description: string | null };
  members: Member[];
  roles: Role[];
}

export function GroupDetail({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const key = ['admin', 'group', groupId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<GroupDetailData>(`/api/admin/groups/${groupId}`),
  });
  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<{ roles: Role[] }>('/api/admin/roles'),
  });
  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiGet<{ users: Member[] }>('/api/admin/users'),
  });
  const [roleId, setRoleId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const removeMember = useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/admin/groups/${groupId}/members/${userId}`),
    onSuccess: invalidate,
  });
  const addMembers = useMutation({
    mutationFn: async (userIds: string[]) => {
      for (const userId of userIds) {
        await apiPost(`/api/admin/groups/${groupId}/members`, { userId });
      }
    },
    onSuccess: () => {
      setMemberIds([]);
      invalidate();
    },
  });
  const assignRole = useMutation({
    mutationFn: (rid: string) => apiPost(`/api/admin/groups/${groupId}/roles`, { roleId: rid }),
    onSuccess: () => {
      setRoleId('');
      invalidate();
    },
  });

  const assignedIds = new Set((data?.roles ?? []).map((r) => r.id));
  const available = (rolesData?.roles ?? []).filter((r) => !assignedIds.has(r.id));
  const currentMemberIds = new Set((data?.members ?? []).map((m) => m.id));
  const nonMembers = (usersData?.users ?? []).filter((u) => !currentMemberIds.has(u.id));

  return (
    <div className="group-detail" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0 }}>{data?.group.name}</h2>

        <Card title="Members">
          <ul className="row-list">
            {(data?.members ?? []).map((m) => (
              <li key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>{m.email}</span>
                <Button size="sm" variant="danger" onClick={() => removeMember.mutate(m.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
            <label className="field">
              <span className="field-label">Members</span>
              <select
                className="input"
                multiple
                aria-label="Members"
                value={memberIds}
                onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              >
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={memberIds.length === 0} onClick={() => addMembers.mutate(memberIds)}>
              Add members
            </Button>
          </div>
        </Card>

        <Card title="Roles">
          <ul className="row-list">
            {(data?.roles ?? []).map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
            <label className="field">
              <span className="field-label">Role</span>
              <select
                className="input"
                aria-label="Role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                <option value="">Select a role…</option>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={!roleId} onClick={() => roleId && assignRole.mutate(roleId)}>
              Assign role
            </Button>
          </div>
        </Card>
      </div>

      <ChangeHistory targetType="group" targetId={groupId} />
    </div>
  );
}
