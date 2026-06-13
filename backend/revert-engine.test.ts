import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { createTestApp, seedUserWithPermissions, getCapturedEvents } from '@panacea/shared/testkit';
import type { FastifyInstance } from 'fastify';
import adminPlugin from './index.js';
import type { DomainCtx } from './domain/context.js';
import { updateUser, setUserStatus } from './domain/users.js';
import { addGroupMember, removeGroupMember } from './domain/groups.js';
import { addRolePermission } from './domain/roles.js';
import { revertChange } from './revert-engine.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let app: FastifyInstance;
let actor: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  app = await createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
  actor = await seedUserWithPermissions(db, []);
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  await container?.stop();
});

// Setup mutations run as plain 'ui' actions with a no-op event sink; only reverts
// (which go through `app`) publish into the captured-events buffer.
function setupCtx(): DomainCtx {
  return { db, publishEvent: () => {}, actorId: actor, source: 'ui' };
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

describe('revert engine', () => {
  it('revert of a field update restores the prior value', async () => {
    // TDD: revert-engine.test.ts — revert of a field update restores the prior value | positive
    const id = await makeUser('re-field@x.com', 'A');
    await updateUser(setupCtx(), { id, changes: { name: 'B' } });
    const logId = await latestLogId(id, 'user.updated');

    await revertChange(db, app, logId, actor);

    const [u] = await db<{ name: string }[]>`SELECT name FROM users WHERE id = ${id}`;
    expect(u.name).toBe('A');
  });

  it('revert writes a new entry with reverts_id set and source=revert', async () => {
    // TDD: revert-engine.test.ts — revert writes a new entry with reverts_id set and source='revert' | positive
    const id = await makeUser('re-entry@x.com', 'A');
    await updateUser(setupCtx(), { id, changes: { name: 'B' } });
    const logId = await latestLogId(id, 'user.updated');

    const entry = await revertChange(db, app, logId, actor);

    expect(entry.reverts_id).toBe(logId);
    expect(entry.source).toBe('revert');
  });

  it('revert of a group-member add removes the member', async () => {
    // TDD: revert-engine.test.ts — revert of a group-member add removes the member | positive
    const [g] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('RE Add') RETURNING id`;
    const uid = await makeUser('re-add-member@x.com');
    await addGroupMember(setupCtx(), { groupId: g.id, userId: uid });
    const logId = await latestLogId(g.id, 'group.member.added');

    await revertChange(db, app, logId, actor);

    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text count FROM group_members WHERE group_id = ${g.id} AND user_id = ${uid}`;
    expect(Number(count)).toBe(0);
  });

  it('revert of a role-permission assignment removes the permission', async () => {
    // TDD: revert-engine.test.ts — revert of a role→permission assignment removes the permission | positive
    const [role] = await db<{ id: string }[]>`INSERT INTO roles (name) VALUES ('RE Role') RETURNING id`;
    const [perm] = await db<{ id: string }[]>`
      INSERT INTO permissions (key, label, level, module)
      VALUES ('ticketing:tickets:read', 'Read', 'function', 'ticketing')
      ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label RETURNING id`;
    await addRolePermission(setupCtx(), { roleId: role.id, permissionId: perm.id });
    const logId = await latestLogId(role.id, 'role.permission.added');

    await revertChange(db, app, logId, actor);

    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text count FROM role_permissions WHERE role_id = ${role.id} AND permission_id = ${perm.id}`;
    expect(Number(count)).toBe(0);
  });

  it('revert of a removed link re-adds it', async () => {
    // TDD: revert-engine.test.ts — revert of a removed link re-adds it | positive
    const [g] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('RE Re-add') RETURNING id`;
    const uid = await makeUser('re-readd-member@x.com');
    await addGroupMember(setupCtx(), { groupId: g.id, userId: uid });
    await removeGroupMember(setupCtx(), { groupId: g.id, userId: uid });
    const logId = await latestLogId(g.id, 'group.member.removed');

    await revertChange(db, app, logId, actor);

    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text count FROM group_members WHERE group_id = ${g.id} AND user_id = ${uid}`;
    expect(Number(count)).toBe(1);
  });

  it('reverting through the domain function re-publishes the matching event', async () => {
    // TDD: revert-engine.test.ts — reverting through the domain function re-publishes the matching event | positive
    const id = await makeUser('re-event@x.com');
    await setUserStatus(setupCtx(), { id, status: 'inactive' });
    const logId = await latestLogId(id, 'user.deactivated');

    await revertChange(db, app, logId, actor);

    expect(getCapturedEvents(app).map((e) => e.event)).toContain('user.reactivated');
  });
});
