import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input } from '@panacea/ui';
import { apiGet, apiPatch, apiPost, apiDelete } from '../api.js';
import { ChangeHistory } from '../components/ChangeHistory.js';

interface Group {
  id: string;
  name: string;
}
interface UserDetailData {
  user: { id: string; name: string | null; email: string; status: string };
  groups: Group[];
}

export function UserDetail({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const key = ['admin', 'user', userId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<UserDetailData>(`/api/admin/users/${userId}`),
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('active');
  const seeded = useRef(false);
  useEffect(() => {
    if (data?.user && !seeded.current) {
      setName(data.user.name ?? '');
      setEmail(data.user.email);
      setStatus(data.user.status);
      seeded.current = true;
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiPatch(`/api/admin/users/${userId}`, { name, email, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const { data: groupsData } = useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: () => apiGet<{ groups: Group[] }>('/api/admin/groups'),
  });
  const [groupId, setGroupId] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const addToGroup = useMutation({
    mutationFn: (gid: string) => apiPost(`/api/admin/groups/${gid}/members`, { userId }),
    onSuccess: () => {
      setGroupId('');
      invalidate();
    },
  });
  const removeFromGroup = useMutation({
    mutationFn: (gid: string) => apiDelete(`/api/admin/groups/${gid}/members/${userId}`),
    onSuccess: invalidate,
  });

  const memberOf = new Set((data?.groups ?? []).map((g) => g.id));
  const otherGroups = (groupsData?.groups ?? []).filter((g) => !memberOf.has(g.id));

  return (
    <div className="user-detail" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0 }}>{data?.user.email}</h2>

        <Card title="Edit user">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360 }}>
            <Input label="Name" value={name} onChange={setName} />
            <Input label="Email" value={email} onChange={setEmail} />
            <label className="field">
              <span className="field-label">Status</span>
              <select
                className="input"
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
            <div>
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Groups">
          <ul className="row-list">
            {(data?.groups ?? []).map((g) => (
              <li key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>{g.name}</span>
                <Button size="sm" variant="danger" onClick={() => removeFromGroup.mutate(g.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
            <label className="field">
              <span className="field-label">Group</span>
              <select
                className="input"
                aria-label="Group"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">Select a group…</option>
                {otherGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={!groupId} onClick={() => groupId && addToGroup.mutate(groupId)}>
              Add to group
            </Button>
          </div>
        </Card>
      </div>

      <ChangeHistory targetType="user" targetId={userId} />
    </div>
  );
}
