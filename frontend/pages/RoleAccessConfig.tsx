import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../api.js';

interface Leaf { id: string; key: string; label: string }
interface PageNode { page: string; access: Leaf | null; functions: Leaf[] }
interface ModuleNode { module: string; access: Leaf | null; functions: Leaf[]; pages: PageNode[] }
interface PermTree { modules: ModuleNode[] }
interface RolesData { roles: { id: string; name: string; permissions: string[] }[] }

export function RoleAccessConfig({ roleId }: { roleId: string }) {
  const { data: tree } = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: () => apiGet<PermTree>('/api/admin/permissions'),
  });
  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<RolesData>('/api/admin/roles'),
  });
  const role = rolesData?.roles.find((r) => r.id === roleId);

  const [granted, setGranted] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (role && !seeded.current) {
      setGranted(new Set(role.permissions));
      seeded.current = true;
    }
  }, [role]);

  async function toggle(node: Leaf) {
    const has = granted.has(node.key);
    setGranted((prev) => {
      const next = new Set(prev);
      if (has) next.delete(node.key);
      else next.add(node.key);
      return next;
    });
    if (has) await apiDelete(`/api/admin/roles/${roleId}/permissions/${node.id}`);
    else await apiPost(`/api/admin/roles/${roleId}/permissions`, { permissionId: node.id });
  }

  const checkbox = (node: Leaf, disabled = false) => (
    <label key={node.id}>
      <input
        type="checkbox"
        aria-label={node.label}
        checked={granted.has(node.key)}
        disabled={disabled}
        onChange={() => toggle(node)}
      />
      {node.label}
    </label>
  );

  return (
    <div className="role-access-config">
      {(tree?.modules ?? []).map((m) => {
        const moduleOn = m.access ? granted.has(m.access.key) : true;
        return (
          <section key={m.module} aria-label={`module-${m.module}`}>
            {m.access && checkbox(m.access)}
            {m.functions.map((fn) => checkbox(fn, !moduleOn))}
            {m.pages.map((p) => {
              const pageOn = p.access ? granted.has(p.access.key) : true;
              return (
                <div key={p.page} aria-label={`page-${p.page}`}>
                  {p.access && checkbox(p.access, !moduleOn)}
                  {p.functions.map((fn) => checkbox(fn, !moduleOn || !pageOn))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
