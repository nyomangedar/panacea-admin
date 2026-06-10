import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyCoreMigrations, syncPermissions, type PermissionDef } from '@panacea/shared';
import { createTestApp, asUser, seedUserWithPermissions } from '@panacea/shared/testkit';
import adminPlugin from '../index.js';

let container: StartedPostgreSqlContainer;
let db: Sql;
let adminUser: string;

const defs: PermissionDef[] = [
  { key: 'admin:access', label: 'Access Admin', level: 'module' },
  { key: 'admin:users:access', label: 'Users', level: 'page', page: 'Users' },
  { key: 'admin:users:create', label: 'Create user', level: 'function', page: 'Users' },
];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  const uri = container.getConnectionUri();
  await applyCoreMigrations(uri);
  db = postgres(uri, { max: 2 });
  await syncPermissions(db, defs);
  adminUser = await seedUserWithPermissions(db, ['admin:roles:read']);
});

afterAll(async () => {
  await db?.end();
  await container?.stop();
});

describe('GET /api/admin/permissions', () => {
  it('returns the module → page → function tree', async () => {
    // TDD: permission-registry.test.ts — GET /api/admin/permissions returns the module → page → function tree | positive
    const app = await createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions',
      headers: asUser(adminUser),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      modules: {
        module: string;
        access: { key: string } | null;
        pages: { page: string; access: { key: string } | null; functions: { key: string }[] }[];
      }[];
    }>();

    const admin = body.modules.find((m) => m.module === 'admin')!;
    expect(admin.access?.key).toBe('admin:access');
    const usersPage = admin.pages.find((p) => p.page === 'Users')!;
    expect(usersPage.access?.key).toBe('admin:users:access');
    expect(usersPage.functions.map((f) => f.key)).toContain('admin:users:create');

    await app.close();
  });

  it('returns 403 without the admin:roles:read permission', async () => {
    // TDD: permission-registry.test.ts — GET /api/admin/permissions returns the module → page → function tree | negative
    const noPerm = await seedUserWithPermissions(db, []);
    const app = await createTestApp({ db, module: { plugin: adminPlugin, prefix: '/api/admin' } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions',
      headers: asUser(noPerm),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
