import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations, writeAudit } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions } from '@panacea/shared/testkit';
import adminPlugin from '../index.js';
import type { DomainCtx } from '../domain/context.js';
import { updateUser } from '../domain/users.js';
import { addGroupMember, removeGroupMember } from '../domain/groups.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let admin: string;
let noRevert: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  admin = await seedUserWithPermissions(db, ['admin:audit:read', 'admin:audit:revert']);
  noRevert = await seedUserWithPermissions(db, ['admin:audit:read']);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

function ctx(): DomainCtx {
  return { db, publishEvent: () => {}, actorId: admin, source: 'ui' };
}

async function app() {
  return createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
}

async function latestLogId(targetId: string, action: string): Promise<string> {
  const [r] = await db<{ id: string }[]>`
    SELECT id FROM audit_logs WHERE target_id = ${targetId} AND action = ${action}
    ORDER BY created_at DESC LIMIT 1`;
  return r.id;
}

async function makeUser(email: string, name = 'A'): Promise<string> {
  const [u] = await db<{ id: string }[]>`
    INSERT INTO users (name, email, password_hash, status)
    VALUES (${name}, ${email}, 'x', 'active') RETURNING id`;
  return u.id;
}

describe('revert route', () => {
  it('returns 409 changed_since when the entity changed after that version', async () => {
    // TDD: revert-routes.test.ts — POST /audit-logs/:id/revert returns 409 changed_since when entity changed after that version | negative
    const id = await makeUser('rr-changed@x.com', 'A');
    await updateUser(ctx(), { id, changes: { name: 'B' } });
    const logId = await latestLogId(id, 'user.updated');
    await updateUser(ctx(), { id, changes: { name: 'C' } });

    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/audit-logs/${logId}/revert`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ conflict: string }>().conflict).toBe('changed_since');
    await a.close();
  });

  it('returns 409 entity_missing when a re-add target no longer exists', async () => {
    // TDD: revert-routes.test.ts — returns 409 entity_missing when a re-add target no longer exists | negative
    const [g] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('RR Missing') RETURNING id`;
    const uid = await makeUser('rr-missing-member@x.com');
    await addGroupMember(ctx(), { groupId: g.id, userId: uid });
    await removeGroupMember(ctx(), { groupId: g.id, userId: uid });
    const logId = await latestLogId(g.id, 'group.member.removed');
    await db`DELETE FROM users WHERE id = ${uid}`;

    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/audit-logs/${logId}/revert`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ conflict: string }>().conflict).toBe('entity_missing');
    await a.close();
  });

  it('returns 409 unsupported for a create/delete entry', async () => {
    // TDD: revert-routes.test.ts — returns 409 unsupported for a create/delete entry | negative
    const [g] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('RR Create') RETURNING id`;
    await writeAudit(db, {
      actorId: admin,
      action: 'group.created',
      targetType: 'group',
      targetId: g.id,
      op: 'create',
      after: { name: 'RR Create' },
      source: 'ui',
    });
    const logId = await latestLogId(g.id, 'group.created');

    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/audit-logs/${logId}/revert`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ conflict: string }>().conflict).toBe('unsupported');
    await a.close();
  });

  it('returns 403 without admin:audit:revert permission', async () => {
    // TDD: revert-routes.test.ts — returns 403 without admin:audit:revert permission | negative
    const id = await makeUser('rr-403@x.com', 'A');
    await updateUser(ctx(), { id, changes: { name: 'B' } });
    const logId = await latestLogId(id, 'user.updated');

    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: `/api/admin/audit-logs/${logId}/revert`,
      headers: asUser(noRevert),
    });
    expect(res.statusCode).toBe(403);
    await a.close();
  });
});
