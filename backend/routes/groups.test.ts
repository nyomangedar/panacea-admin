import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions } from '@panacea/shared/testkit';
import adminPlugin from '../index.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let admin: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  admin = await seedUserWithPermissions(db, ['admin:groups:manage', 'admin:groups:read']);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

async function makeGroup(a: Awaited<ReturnType<typeof app>>, name: string): Promise<string> {
  const r = await a.inject({
    method: 'POST',
    url: '/api/admin/groups',
    headers: asUser(admin),
    payload: { name },
  });
  return r.json<{ group: { id: string } }>().group.id;
}

async function makeUser(email: string): Promise<string> {
  const [u] = await db<{ id: string }[]>`
    INSERT INTO users (email, password_hash, status) VALUES (${email}, 'x', 'active') RETURNING id`;
  return u.id;
}

describe('group routes', () => {
  it('POST /groups creates group', async () => {
    // TDD: group-routes.test.ts — POST /groups creates group | positive
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/api/admin/groups',
      headers: asUser(admin),
      payload: { name: 'Support', description: 'Tier 1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ group: { name: string } }>().group.name).toBe('Support');
    await a.close();
  });

  it('POST /groups/:id/members adds user to group', async () => {
    // TDD: group-routes.test.ts — POST /groups/:id/members adds user to group | positive
    const a = await app();
    const gid = await makeGroup(a, 'Members A');
    const uid = await makeUser('m1@x.com');
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/groups/${gid}/members`,
      headers: asUser(admin),
      payload: { userId: uid },
    });
    expect(res.statusCode).toBe(201);
    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM group_members WHERE group_id = ${gid}`;
    expect(Number(count)).toBe(1);
    await a.close();
  });

  it('DELETE /groups/:id/members/:userId removes user', async () => {
    // TDD: group-routes.test.ts — DELETE /groups/:id/members/:userId removes user | positive
    const a = await app();
    const gid = await makeGroup(a, 'Members B');
    const uid = await makeUser('m2@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/groups/${gid}/members`, headers: asUser(admin), payload: { userId: uid } });
    const res = await a.inject({ method: 'DELETE', url: `/api/admin/groups/${gid}/members/${uid}`, headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM group_members WHERE group_id = ${gid}`;
    expect(Number(count)).toBe(0);
    await a.close();
  });

  it('DELETE /groups/:id with members returns 409', async () => {
    // TDD: group-routes.test.ts — DELETE /groups/:id with members returns 409 | negative
    const a = await app();
    const gid = await makeGroup(a, 'HasMembers');
    const uid = await makeUser('m3@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/groups/${gid}/members`, headers: asUser(admin), payload: { userId: uid } });
    const res = await a.inject({ method: 'DELETE', url: `/api/admin/groups/${gid}`, headers: asUser(admin) });
    expect(res.statusCode).toBe(409);
    await a.close();
  });

  it('PATCH /groups/:id updates name and description', async () => {
    // TDD: group-routes.test.ts — PATCH /groups/:id updates name and description | positive
    const a = await app();
    const gid = await makeGroup(a, 'Before Name');
    const res = await a.inject({
      method: 'PATCH',
      url: `/api/admin/groups/${gid}`,
      headers: asUser(admin),
      payload: { name: 'After Name', description: 'changed' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ group: { name: string; description: string } }>();
    expect(body.group.name).toBe('After Name');
    expect(body.group.description).toBe('changed');
    await a.close();
  });

  it('GET /groups/:id returns the group with members and roles', async () => {
    // TDD: group-routes.test.ts — GET /groups/:id returns the group with members and roles | positive
    const a = await app();
    const gid = await makeGroup(a, 'Detail Group');
    const uid = await makeUser('detail@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/groups/${gid}/members`, headers: asUser(admin), payload: { userId: uid } });
    const [role] = await db<{ id: string }[]>`INSERT INTO roles (name) VALUES ('DetailRole') RETURNING id`;
    await db`INSERT INTO group_roles (group_id, role_id) VALUES (${gid}, ${role.id})`;

    const res = await a.inject({ method: 'GET', url: `/api/admin/groups/${gid}`, headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ group: { id: string }; members: { email: string }[]; roles: { name: string }[] }>();
    expect(body.group.id).toBe(gid);
    expect(body.members.map((m) => m.email)).toContain('detail@x.com');
    expect(body.roles.map((r) => r.name)).toContain('DetailRole');
    await a.close();
  });

  it('GET /groups returns groups with member count', async () => {
    // TDD: group-routes.test.ts — GET /groups returns groups with member count | positive
    const a = await app();
    const gid = await makeGroup(a, 'Counted');
    const uid = await makeUser('m4@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/groups/${gid}/members`, headers: asUser(admin), payload: { userId: uid } });
    const res = await a.inject({ method: 'GET', url: '/api/admin/groups', headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    const { groups } = res.json<{ groups: { id: string; member_count: number }[] }>();
    const counted = groups.find((g) => g.id === gid)!;
    expect(counted.member_count).toBe(1);
    await a.close();
  });
});
