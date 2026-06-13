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
    'admin:audit:read',
    'admin:users:create',
    'admin:users:update',
  ]);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

interface EnrichedEntry {
  action: string;
  revertible: boolean;
  reason?: string;
}

describe('audit history enrichment', () => {
  it('GET /audit-logs?target enriches each entry with revertible + reason', async () => {
    // TDD: audit-history.test.ts — GET /audit-logs?target enriches each entry with revertible + reason | positive
    const a = await app();
    const created = await a.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: asUser(admin),
      payload: { name: 'Hist', email: 'hist@x.com', password: 'supersecret' },
    });
    const id = created.json<{ user: { id: string } }>().user.id;
    await a.inject({
      method: 'PATCH',
      url: `/api/admin/users/${id}`,
      headers: asUser(admin),
      payload: { name: 'Hist Renamed' },
    });

    const res = await a.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?target_type=user&target_id=${id}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json<{ entries: EnrichedEntry[] }>().entries;

    const updated = entries.find((e) => e.action === 'user.updated');
    const createdEntry = entries.find((e) => e.action === 'user.created');
    expect(updated?.revertible).toBe(true);
    expect(createdEntry?.revertible).toBe(false);
    expect(typeof createdEntry?.reason).toBe('string');
    await a.close();
  });
});
