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
    'admin:users:deactivate',
    'admin:groups:manage',
    'admin:audit:read',
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

describe('audit log', () => {
  it('deactivating a user writes an audit log entry', async () => {
    // TDD: audit-log.test.ts — deactivating a user writes an audit log entry | positive
    const a = await app();
    const id = await createUser(a, 'au-deact@x.com');
    await a.inject({ method: 'POST', url: `/api/admin/users/${id}/deactivate`, headers: asUser(admin) });
    const rows = await db`
      SELECT id FROM audit_logs WHERE action = 'user.deactivated' AND target_id = ${id}`;
    expect(rows.length).toBe(1);
    await a.close();
  });

  it('adding a user to a group writes an audit log entry', async () => {
    // TDD: audit-log.test.ts — adding a user to a group writes an audit log entry | positive
    const a = await app();
    const id = await createUser(a, 'au-group@x.com');
    const [group] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('AuditGroup') RETURNING id`;
    await a.inject({
      method: 'POST',
      url: `/api/admin/groups/${group.id}/members`,
      headers: asUser(admin),
      payload: { userId: id },
    });
    const rows = await db`
      SELECT id FROM audit_logs WHERE action = 'group.member.added' AND target_id = ${group.id}`;
    expect(rows.length).toBe(1);
    await a.close();
  });

  it('entry contains actor_id, action, target_id, timestamp, source', async () => {
    // TDD: audit-log.test.ts — entry contains actor_id, action, target_id, timestamp, source | positive
    const a = await app();
    const id = await createUser(a, 'au-fields@x.com');
    const [entry] = await db<{
      actor_id: string | null;
      action: string;
      target_id: string | null;
      created_at: string;
      source: string;
      payload: { op: string };
    }[]>`SELECT actor_id, action, target_id, created_at, source, payload
         FROM audit_logs WHERE action = 'user.created' AND target_id = ${id}`;
    expect(entry.actor_id).toBe(admin);
    expect(entry.action).toBe('user.created');
    expect(entry.target_id).toBe(id);
    expect(entry.created_at).toBeTruthy();
    expect(entry.source).toBe('ui');
    expect(entry.payload.op).toBe('create');
    await a.close();
  });

  it('UI-driven action records source=ui', async () => {
    // TDD: audit-log.test.ts — UI-driven action records source='ui' | positive
    const a = await app();
    await createUser(a, 'au-source@x.com');
    const rows = await db<{ source: string }[]>`
      SELECT DISTINCT source FROM audit_logs WHERE action = 'user.created'`;
    expect(rows.every((r) => r.source === 'ui')).toBe(true);
    await a.close();
  });

  it('GET /audit-logs returns paginated entries filterable by source', async () => {
    // TDD: audit-log.test.ts — GET /audit-logs returns paginated entries filterable by source | positive
    const a = await app();
    await createUser(a, 'au-list@x.com');
    const res = await a.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?source=ui&page=1&pageSize=5',
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      entries: { source: string }[];
      total: number;
      page: number;
      pageSize: number;
    }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(5);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.source === 'ui')).toBe(true);
    await a.close();
  });
});
