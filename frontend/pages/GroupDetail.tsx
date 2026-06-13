import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@panacea/ui';
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
  const [roleId, setRoleId] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const removeMember = useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/admin/groups/${groupId}/members/${userId}`),
    onSuccess: invalidate,
  });
  const assignRole = useMutation({
    mutationFn: (rid: string) => apiPost(`/api/admin/groups/${groupId}/roles`, { roleId: rid }),
    onSuccess: invalidate,
  });

  return (
    <div className="group-detail">
      <h2>{data?.group.name}</h2>

      <section>
        <h3>Members</h3>
        <ul>
          {(data?.members ?? []).map((m) => (
            <li key={m.id}>
              <span>{m.email}</span>
              <Button size="sm" variant="danger" onClick={() => removeMember.mutate(m.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Roles</h3>
        <ul>
          {(data?.roles ?? []).map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
        <Input label="Role ID" value={roleId} onChange={setRoleId} />
        <Button onClick={() => assignRole.mutate(roleId)}>Assign role</Button>
      </section>

      <ChangeHistory targetType="group" targetId={groupId} />
    </div>
  );
}
