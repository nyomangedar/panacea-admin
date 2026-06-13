import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions } from '@panacea/shared/testkit';
import { parseCsvRecords } from '../csv.js';
import adminPlugin from '../index.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let admin: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  admin = await seedUserWithPermissions(db, ['admin:export', 'admin:import']);

  const [u] = await db<{ id: string }[]>`
    INSERT INTO users (name, email, password_hash, status)
    VALUES ('Export Me', 'exp@x.com', 'x', 'active') RETURNING id`;
  const [g] = await db<{ id: string }[]>`INSERT INTO groups (name) VALUES ('ExpGroup') RETURNING id`;
  await db`INSERT INTO group_members (user_id, group_id) VALUES (${u.id}, ${g.id})`;
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

describe('GET /api/admin/export', () => {
  it('emits all 6 CSVs keyed by natural identifiers (no ids)', async () => {
    // TDD: export.test.ts — GET /export emits all 6 CSVs keyed by natural identifiers (no ids) | positive
    const app = await createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/export', headers: asUser(admin) });
    expect(res.statusCode).toBe(200);

    const body = res.json<Record<string, string>>();
    expect(Object.keys(body).sort()).toEqual([
      'group_members',
      'group_roles',
      'groups',
      'role_permissions',
      'roles',
      'users',
    ]);

    const users = parseCsvRecords(body.users);
    expect(Object.keys(users[0])).toEqual(['name', 'email', 'status']); // natural keys, no id
    expect(users.some((u) => u.email === 'exp@x.com')).toBe(true);

    const members = parseCsvRecords(body.group_members);
    expect(members[0]).toEqual({ user_email: 'exp@x.com', group_name: 'ExpGroup' });

    await app.close();
  });
});

function multipart(files: Record<string, string>): { payload: string; headers: Record<string, string> } {
  const boundary = `----panacea${Math.random().toString(16).slice(2)}`;
  let payload = '';
  for (const [name, content] of Object.entries(files)) {
    payload +=
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"; filename="${name}.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n${content}\r\n`;
  }
  payload += `--${boundary}--\r\n`;
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function importBundle(files: Record<string, string>) {
  const app = await createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
  const { payload, headers } = multipart(files);
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/import',
    headers: { ...headers, ...asUser(admin) },
    payload,
  });
  await app.close();
  return res;
}

describe('POST /api/admin/import', () => {
  it('creates entities then joins in dependency order', async () => {
    // TDD: import.test.ts — POST /import creates entities then joins in dependency order | positive
    const res = await importBundle({
      users: 'name,email,status\nAlice,alice@imp.com,active\nBob,bob@imp.com,active',
      groups: 'name,description\nTeam A,first team',
      group_members: 'user_email,group_name\nalice@imp.com,Team A',
    });
    expect(res.statusCode).toBe(200);
    const { report } = res.json<{ report: Record<string, { created: number }> }>();
    expect(report.users.created).toBe(2);
    expect(report.groups.created).toBe(1);
    expect(report.group_members.created).toBe(1);

    const [{ count }] = await db<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM group_members gm
      JOIN users u ON u.id = gm.user_id JOIN groups g ON g.id = gm.group_id
      WHERE u.email = 'alice@imp.com' AND g.name = 'Team A'`;
    expect(Number(count)).toBe(1);
  });

  it('skip-existing: re-importing the same bundle creates 0, skips all', async () => {
    // TDD: import.test.ts — skip-existing: re-importing the same bundle creates 0, skips all | positive
    const bundle = { users: 'name,email,status\nSkippy,skip@imp.com,active' };
    const first = await importBundle(bundle);
    expect(first.json<{ report: { users: { created: number } } }>().report.users.created).toBe(1);
    const second = await importBundle(bundle);
    const r = second.json<{ report: { users: { created: number; skipped: number } } }>().report.users;
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('reports errors for join rows referencing missing entities', async () => {
    // TDD: import.test.ts — join row referencing a missing entity is reported as an error, others still apply | negative
    const res = await importBundle({
      groups: 'name,description\nReal Group,x',
      group_members: 'user_email,group_name\nghost@imp.com,Real Group',
    });
    const { report } = res.json<{ report: { group_members: { created: number; errors: { reason: string }[] } } }>();
    expect(report.group_members.errors.length).toBe(1);
    expect(report.group_members.errors[0].reason).toContain('user not found');
  });

  it('returns a temp password once per created user', async () => {
    // TDD: import.test.ts — created user gets a random temp password returned once in the result | positive
    const res = await importBundle({ users: 'name,email,status\nTemp,temp@imp.com,active' });
    const { tempPasswords } = res.json<{ tempPasswords: { email: string; password: string }[] }>();
    const mine = tempPasswords.filter((t) => t.email === 'temp@imp.com');
    expect(mine).toHaveLength(1);
    expect(mine[0].password.length).toBeGreaterThan(0);
  });

  it('import writes one audit entry per created object with source=import', async () => {
    // TDD: audit-log.test.ts — import writes one entry per created object with source='import' | positive
    await importBundle({ users: 'name,email,status\nAudited,audit-imp@imp.com,active' });
    const rows = await db<{ source: string }[]>`
      SELECT al.source FROM audit_logs al
      JOIN users u ON u.id = al.target_id
      WHERE u.email = 'audit-imp@imp.com' AND al.action = 'user.created'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('import');
  });

  it('import audits group_roles and role_permissions links with source=import', async () => {
    // TDD: import.test.ts — import audits group_roles and role_permissions link.add entries with source='import' | positive
    await db`INSERT INTO permissions (key, label, level, module)
      VALUES ('ticketing:tickets:write', 'Write', 'function', 'ticketing')
      ON CONFLICT (key) DO NOTHING`;
    await importBundle({
      groups: 'name,description\nLinked Group,x',
      roles: 'name,description\nLinked Role,x',
      group_roles: 'group_name,role_name\nLinked Group,Linked Role',
      role_permissions: 'role_name,permission_key\nLinked Role,ticketing:tickets:write',
    });

    const gr = await db<{ source: string }[]>`
      SELECT source FROM audit_logs WHERE action = 'group.role.added' AND source = 'import'`;
    const rp = await db<{ source: string }[]>`
      SELECT source FROM audit_logs WHERE action = 'role.permission.added' AND source = 'import'`;
    expect(gr.length).toBeGreaterThanOrEqual(1);
    expect(rp.length).toBeGreaterThanOrEqual(1);
  });
});
