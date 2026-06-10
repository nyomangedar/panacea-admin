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
  admin = await seedUserWithPermissions(db, [
    'admin:users:create',
    'admin:users:update',
    'admin:users:read',
    'admin:users:deactivate',
  ]);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

describe('user routes', () => {
  it('POST /users creates user and returns 201', async () => {
    // TDD: user-routes.test.ts — POST /users creates user and returns 201 | positive
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'Jane Doe', email: 'jane@x.com', password: 'supersecret' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: { id: string; email: string; status: string } }>();
    expect(body.user.email).toBe('jane@x.com');
    expect(body.user.status).toBe('active');
    await a.close();
  });

  it('POST /users with duplicate email returns 409', async () => {
    // TDD: user-routes.test.ts — POST /users with duplicate email returns 409 | negative
    const a = await app();
    const payload = { name: 'Dup', email: 'dup@x.com', password: 'supersecret' };
    const first = await a.inject({ method: 'POST', url: '/api/admin/users', headers: asUser(admin), payload });
    expect(first.statusCode).toBe(201);
    const second = await a.inject({ method: 'POST', url: '/api/admin/users', headers: asUser(admin), payload });
    expect(second.statusCode).toBe(409);
    await a.close();
  });

  it('PATCH /users/:id updates name and email', async () => {
    // TDD: user-routes.test.ts — PATCH /users/:id updates name and email | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'Old Name', email: 'old@x.com', password: 'supersecret' },
    });
    const { user } = created.json<{ user: { id: string } }>();

    const res = await a.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      headers: asUser(admin),
      payload: { name: 'New Name', email: 'new@x.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { name: string; email: string } }>();
    expect(body.user.name).toBe('New Name');
    expect(body.user.email).toBe('new@x.com');
    await a.close();
  });

  it('POST /users/:id/deactivate sets status to inactive', async () => {
    // TDD: user-routes.test.ts — POST /users/:id/deactivate sets status to inactive | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'To Deactivate', email: 'deact@x.com', password: 'supersecret' },
    });
    const { user } = created.json<{ user: { id: string } }>();

    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/deactivate`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ user: { status: string } }>().user.status).toBe('inactive');
    await a.close();
  });

  it('GET /users returns paginated list filtered by group', async () => {
    // TDD: user-routes.test.ts — GET /users returns paginated list filtered by group | positive
    const a = await app();
    const mk = async (email: string) => {
      const r = await a.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: asUser(admin),
        payload: { name: email, email, password: 'supersecret' },
      });
      return r.json<{ user: { id: string } }>().user.id;
    };
    const inGroup = await mk('ingroup@x.com');
    await mk('notingroup@x.com');

    const [group] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('Filter Group') RETURNING id`;
    await db`INSERT INTO group_members (user_id, group_id) VALUES (${inGroup}, ${group.id})`;

    const res = await a.inject({
      method: 'GET',
      url: `/api/admin/users?group=${group.id}&page=1&pageSize=10`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ users: { id: string }[]; total: number; page: number; pageSize: number }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.total).toBe(1);
    expect(body.users.map((u) => u.id)).toEqual([inGroup]);
    await a.close();
  });

  it('POST /users/:id/reactivate sets status to active', async () => {
    // TDD: user-routes.test.ts — POST /users/:id/reactivate sets status to active | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'Re', email: 'react@x.com', password: 'supersecret' },
    });
    const { user } = created.json<{ user: { id: string } }>();
    await a.inject({ method: 'POST', url: `/api/admin/users/${user.id}/deactivate`, headers: asUser(admin) });

    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/reactivate`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ user: { status: string } }>().user.status).toBe('active');
    await a.close();
  });

  it('GET /users/:id returns the user (404 when unknown)', async () => {
    // TDD: user-routes.test.ts — GET /users/:id returns the user (404 when unknown) | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'Find Me', email: 'find@x.com', password: 'supersecret' },
    });
    const { user } = created.json<{ user: { id: string } }>();

    const found = await a.inject({ method: 'GET', url: `/api/admin/users/${user.id}`, headers: asUser(admin) });
    expect(found.statusCode).toBe(200);
    expect(found.json<{ user: { email: string } }>().user.email).toBe('find@x.com');

    const missing = await a.inject({
      method: 'GET',
      url: '/api/admin/users/00000000-0000-0000-0000-000000000000',
      headers: asUser(admin),
    });
    expect(missing.statusCode).toBe(404);
    await a.close();
  });
});
