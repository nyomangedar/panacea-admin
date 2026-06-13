import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { seedUserWithPermissions } from '@panacea/shared/testkit';
import type { DomainCtx } from './context.js';
import { updateUser } from './users.js';
import { addGroupMember, removeGroupMember } from './groups.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let actor: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  actor = await seedUserWithPermissions(db, []);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

function ctx(): DomainCtx {
  return { db, publishEvent: () => {}, actorId: actor, source: 'ui' };
}

interface AuditRow {
  op: string;
  before: { name?: string; user_id?: string } | null;
  after: { name?: string; user_id?: string } | null;
}

async function latestAudit(targetId: string, action: string): Promise<AuditRow> {
  const [row] = await db<{ payload: AuditRow }[]>`
    SELECT payload FROM audit_logs
    WHERE target_id = ${targetId} AND action = ${action}
    ORDER BY created_at DESC LIMIT 1`;
  return row.payload;
}

describe('domain audit payload', () => {
  it('captures { op:update, before, after } for a field change', async () => {
    // TDD: write-audit.test.ts — captures { op:'update', before, after } for a field change | positive
    const [u] = await db<{ id: string }[]>`
      INSERT INTO users (name, email, password_hash, status)
      VALUES ('Old Name', 'wa-update@x.com', 'x', 'active') RETURNING id`;

    await updateUser(ctx(), { id: u.id, changes: { name: 'New Name' } });

    const payload = await latestAudit(u.id, 'user.updated');
    expect(payload.op).toBe('update');
    expect(payload.before?.name).toBe('Old Name');
    expect(payload.after?.name).toBe('New Name');
  });

  it('captures { op:link.add } / { op:link.remove } for join changes', async () => {
    // TDD: write-audit.test.ts — captures { op:'link.add' } / { op:'link.remove' } for join changes | positive
    const [g] = await db<{ id: string }[]>`
      INSERT INTO groups (name) VALUES ('WA Group') RETURNING id`;
    const [m] = await db<{ id: string }[]>`
      INSERT INTO users (name, email, password_hash, status)
      VALUES ('Member', 'wa-member@x.com', 'x', 'active') RETURNING id`;

    await addGroupMember(ctx(), { groupId: g.id, userId: m.id });
    const added = await latestAudit(g.id, 'group.member.added');
    expect(added.op).toBe('link.add');
    expect(added.after?.user_id).toBe(m.id);

    await removeGroupMember(ctx(), { groupId: g.id, userId: m.id });
    const removed = await latestAudit(g.id, 'group.member.removed');
    expect(removed.op).toBe('link.remove');
    expect(removed.before?.user_id).toBe(m.id);
  });
});
