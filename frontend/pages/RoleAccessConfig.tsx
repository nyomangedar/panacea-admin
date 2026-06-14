import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Modal } from '@panacea/ui';
import { apiGet, apiPost, apiDelete } from '../api.js';
import { ChangeHistory } from '../components/ChangeHistory.js';

interface Leaf { id: string; key: string; label: string }
interface PageNode { page: string; access: Leaf | null; functions: Leaf[] }
interface ModuleNode { module: string; access: Leaf | null; functions: Leaf[]; pages: PageNode[] }
interface PermTree { modules: ModuleNode[] }
interface RolesData { roles: { id: string; name: string; permissions: string[] }[] }

export function RoleAccessConfig({ roleId }: { roleId: string }) {
  const qc = useQueryClient();
  const { data: tree } = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => apiGet<PermTree>('/api/admin/permissions'),
  });
  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<RolesData>('/api/admin/roles'),
  });
  const role = rolesData?.roles.find((r) => r.id === roleId);

  // `baseline` = what's persisted; `staged` = the in-progress edit. Toggles only touch
  // `staged`; nothing is sent until the user reviews and confirms.
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (role && !seeded.current) {
      setBaseline(new Set(role.permissions));
      setStaged(new Set(role.permissions));
      seeded.current = true;
    }
  }, [role]);

  const leaves = useMemo(() => {
    const byKey = new Map<string, Leaf>();
    for (const m of tree?.modules ?? []) {
      if (m.access) byKey.set(m.access.key, m.access);
      m.functions.forEach((fn) => byKey.set(fn.key, fn));
      for (const p of m.pages) {
        if (p.access) byKey.set(p.access.key, p.access);
        p.functions.forEach((fn) => byKey.set(fn.key, fn));
      }
    }
    return byKey;
  }, [tree]);

  const added = [...staged].filter((k) => !baseline.has(k));
  const removed = [...baseline].filter((k) => !staged.has(k));
  const dirty = added.length > 0 || removed.length > 0;

  function toggle(node: Leaf) {
    setStaged((prev) => {
      const next = new Set(prev);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
  }

  const commit = useMutation({
    mutationFn: async () => {
      for (const key of added) {
        const id = leaves.get(key)?.id;
        if (id) await apiPost(`/api/admin/roles/${roleId}/permissions`, { permissionId: id });
      }
      for (const key of removed) {
        const id = leaves.get(key)?.id;
        if (id) await apiDelete(`/api/admin/roles/${roleId}/permissions/${id}`);
      }
    },
    onSuccess: () => {
      setBaseline(new Set(staged));
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });

  const labelFor = (key: string) => leaves.get(key)?.label ?? key;

  const checkbox = (node: Leaf, disabled = false) => (
    <label key={node.id}>
      <input
        type="checkbox"
        aria-label={node.label}
        checked={staged.has(node.key)}
        disabled={disabled}
        onChange={() => toggle(node)}
      />
      {node.label}
    </label>
  );

  return (
    <div className="role-access-config" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card
          title="Permissions"
          footer={
            <Button disabled={!dirty} onClick={() => setConfirming(true)}>
              Save changes
            </Button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(tree?.modules ?? []).map((m) => {
              const moduleOn = m.access ? staged.has(m.access.key) : true;
              return (
                <section
                  key={m.module}
                  aria-label={`module-${m.module}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  {m.access && checkbox(m.access)}
                  {m.functions.map((fn) => checkbox(fn, !moduleOn))}
                  {m.pages.map((p) => {
                    const pageOn = p.access ? staged.has(p.access.key) : true;
                    return (
                      <div
                        key={p.page}
                        aria-label={`page-${p.page}`}
                        style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16 }}
                      >
                        {p.access && checkbox(p.access, !moduleOn)}
                        {p.functions.map((fn) => checkbox(fn, !moduleOn || !pageOn))}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </Card>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm permission changes"
        description="Review the changes before they are applied."
        footer={
          <Button variant="primary" loading={commit.isPending} onClick={() => commit.mutate()}>
            Confirm
          </Button>
        }
      >
        {added.length > 0 && (
          <div className="diff-add">
            <strong>Grant:</strong>
            <ul>
              {added.map((k) => (
                <li key={k}>{labelFor(k)}</li>
              ))}
            </ul>
          </div>
        )}
        {removed.length > 0 && (
          <div className="diff-remove">
            <strong>Revoke:</strong>
            <ul>
              {removed.map((k) => (
                <li key={k}>{labelFor(k)}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <ChangeHistory targetType="role" targetId={roleId} />
    </div>
  );
}
