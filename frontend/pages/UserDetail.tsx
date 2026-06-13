import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@panacea/ui';
import { apiGet, apiPatch } from '../api.js';
import { ChangeHistory } from '../components/ChangeHistory.js';

interface UserDetailData {
  user: { id: string; name: string | null; email: string; status: string };
  groups: { id: string; name: string }[];
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

  return (
    <div className="user-detail">
      <h2>{data?.user.email}</h2>

      <section aria-label="Edit user">
        <Input label="Name" value={name} onChange={setName} />
        <Input label="Email" value={email} onChange={setEmail} />
        <label>
          Status
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </section>

      <section aria-label="Group memberships">
        <h3>Groups</h3>
        <ul>
          {(data?.groups ?? []).map((g) => (
            <li key={g.id}>{g.name}</li>
          ))}
        </ul>
      </section>

      <ChangeHistory targetType="user" targetId={userId} />
    </div>
  );
}
