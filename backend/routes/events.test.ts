import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions, getCapturedEvents } from '@panacea/shared/testkit';
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
    'admin:users:deactivate',
    'admin:groups:manage',
  ]);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

async function createUser(a: Awaited<ReturnType<typeof app>>, email: string): Promise<string> {
  const r = await a.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: asUser(admin),
    payload: { name: email, email, password: 'supersecret' },
  });
  return r.json<{ user: { id: string } }>().user.id;
}

describe('admin events', () => {
  it('creating a user publishes user.created', async () => {
    // TDD: events.test.ts — creating a user publishes user.created | positive
    const a = await app();
    await createUser(a, 'ev-create@x.com');
    expect(getCapturedEvents(a).map((e) => e.event)).toContain('user.created');
    await a.close();
  });

  it('deactivating a user publishes user.deactivated', async () => {
    // TDD: events.test.ts — deactivating a user publishes user.deactivated | positive
    const a = await app();
    const id = await createUser(a, 'ev-deact@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/users/${id}/deactivate`, headers: asUser(admin) });
    expect(getCapturedEvents(a).map((e) => e.event)).toContain('user.deactivated');
    await a.close();
  });

  it('reactivating a user publishes user.reactivated', async () => {
    // TDD: events.test.ts — reactivating a user publishes user.reactivated | positive
    const a = await app();
    const id = await createUser(a, 'ev-react@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/users/${id}/deactivate`, headers: asUser(admin) });
    await a.inject({ method: 'POST', url: `/api/admin/users/${id}/reactivate`, headers: asUser(admin) });
    expect(getCapturedEvents(a).map((e) => e.event)).toContain('user.reactivated');
    await a.close();
  });

  it('updating a group publishes group.updated', async () => {
    // TDD: events.test.ts — updating a group publishes group.updated | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/groups',
      headers: asUser(admin),
      payload: { name: 'Ev Group' },
    });
    const gid = created.json<{ group: { id: string } }>().group.id;
    await a.inject({ method: 'PATCH', url: `/api/admin/groups/${gid}`, headers: asUser(admin), payload: { description: 'x' } });
    expect(getCapturedEvents(a).map((e) => e.event)).toContain('group.updated');
    await a.close();
  });
});
