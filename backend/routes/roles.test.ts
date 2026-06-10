import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions } from '@panacea/shared/testkit';
import adminPlugin from '../index.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let admin: string;
let permId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  admin = await seedUserWithPermissions(db, [
    'admin:roles:manage',
    'admin:roles:assign',
    'admin:roles:read',
  ]);
  const [perm] = await db<{ id: string }[]>`
    INSERT INTO permissions (key, label, level, module)
    VALUES ('test:assign:me', 'Assign me', 'function', 'test') RETURNING id`;
  permId = perm.id;
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

async function makeRole(a: Awaited<ReturnType<typeof app>>, name: string): Promise<string> {
  const r = await a.inject({ method: 'POST', url: '/api/admin/roles', headers: asUser(admin), payload: { name } });
  return r.json<{ role: { id: string } }>().role.id;
}

describe('role routes', () => {
  it('POST /roles creates role', async () => {
    // TDD: role-routes.test.ts — POST /roles creates role | positive
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/api/admin/roles', headers: asUser(admin), payload: { name: 'Editor' } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ role: { name: string } }>().role.name).toBe('Editor');
    await a.close();
  });

  it('POST /roles/:id/permissions assigns permission to role', async () => {
    // TDD: role-routes.test.ts — POST /roles/:id/permissions assigns permission to role | positive
    const a = await app();
    const rid = await makeRole(a, 'Assigner');
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/roles/${rid}/permissions`,
      headers: asUser(admin),
      payload: { permissionId: permId },
    });
    expect(res.statusCode).toBe(201);
    await a.close();
  });

  it('assigning same permission twice returns 409', async () => {
    // TDD: role-routes.test.ts — assigning same permission twice returns 409 | negative
    const a = await app();
    const rid = await makeRole(a, 'DupAssigner');
    const payload = { permissionId: permId };
    const first = await a.inject({ method: 'POST', url: `/api/admin/roles/${rid}/permissions`, headers: asUser(admin), payload });
    expect(first.statusCode).toBe(201);
    const second = await a.inject({ method: 'POST', url: `/api/admin/roles/${rid}/permissions`, headers: asUser(admin), payload });
    expect(second.statusCode).toBe(409);
    await a.close();
  });

  it('GET /roles returns roles with assigned permissions', async () => {
    // TDD: role-routes.test.ts — GET /roles returns roles with assigned permissions | positive
    const a = await app();
    const rid = await makeRole(a, 'WithPerms');
    await a.inject({ method: 'POST', url: `/api/admin/roles/${rid}/permissions`, headers: asUser(admin), payload: { permissionId: permId } });
    const res = await a.inject({ method: 'GET', url: '/api/admin/roles', headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    const { roles } = res.json<{ roles: { id: string; permissions: string[] }[] }>();
    const role = roles.find((r) => r.id === rid)!;
    expect(role.permissions).toContain('test:assign:me');
    await a.close();
  });

  it('DELETE /roles/:id/permissions/:permissionId removes the permission', async () => {
    // TDD: role-routes.test.ts — DELETE /roles/:id/permissions/:permissionId removes the permission | positive
    const a = await app();
    const rid = await makeRole(a, 'Remover');
    await a.inject({ method: 'POST', url: `/api/admin/roles/${rid}/permissions`, headers: asUser(admin), payload: { permissionId: permId } });
    const res = await a.inject({ method: 'DELETE', url: `/api/admin/roles/${rid}/permissions/${permId}`, headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM role_permissions WHERE role_id = ${rid}`;
    expect(Number(count)).toBe(0);
    await a.close();
  });

  it('POST /groups/:id/roles assigns a role to a group', async () => {
    // TDD: role-routes.test.ts — POST /groups/:id/roles assigns a role to a group | positive
    const a = await app();
    const rid = await makeRole(a, 'GroupRole');
    const [group] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('RoleGroup') RETURNING id`;
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/groups/${group.id}/roles`,
      headers: asUser(admin),
      payload: { roleId: rid },
    });
    expect(res.statusCode).toBe(201);
    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM group_roles WHERE group_id = ${group.id} AND role_id = ${rid}`;
    expect(Number(count)).toBe(1);
    await a.close();
  });
});
