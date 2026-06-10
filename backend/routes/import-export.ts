import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { randomBytes } from 'node:crypto';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { writeAudit } from '@panacea/shared';
import { toCsv, parseCsvRecords } from '../csv.js';
import { actorId } from '../util.js';

interface EntityReport {
  created: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}
const emptyReport = (): EntityReport => ({ created: 0, skipped: 0, errors: [] });

const importExportRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  await app.register(multipart);

  app.get('/export', { preHandler: app.requirePermission('admin:export') }, async () => {
    const users = await db<{ name: string | null; email: string; status: string }[]>`
      SELECT name, email, status FROM users ORDER BY email`;
    const groups = await db<{ name: string; description: string | null }[]>`
      SELECT name, description FROM groups ORDER BY name`;
    const roles = await db<{ name: string; description: string | null }[]>`
      SELECT name, description FROM roles ORDER BY name`;
    const groupMembers = await db<{ user_email: string; group_name: string }[]>`
      SELECT u.email AS user_email, g.name AS group_name
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      JOIN groups g ON g.id = gm.group_id
      ORDER BY g.name, u.email`;
    const groupRoles = await db<{ group_name: string; role_name: string }[]>`
      SELECT g.name AS group_name, r.name AS role_name
      FROM group_roles gr
      JOIN groups g ON g.id = gr.group_id
      JOIN roles r ON r.id = gr.role_id
      ORDER BY g.name, r.name`;
    const rolePermissions = await db<{ role_name: string; permission_key: string }[]>`
      SELECT r.name AS role_name, p.key AS permission_key
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.name, p.key`;

    return {
      users: toCsv(['name', 'email', 'status'], users.map((u) => [u.name, u.email, u.status])),
      groups: toCsv(['name', 'description'], groups.map((g) => [g.name, g.description])),
      roles: toCsv(['name', 'description'], roles.map((r) => [r.name, r.description])),
      group_members: toCsv(['user_email', 'group_name'], groupMembers.map((m) => [m.user_email, m.group_name])),
      group_roles: toCsv(['group_name', 'role_name'], groupRoles.map((x) => [x.group_name, x.role_name])),
      role_permissions: toCsv(['role_name', 'permission_key'], rolePermissions.map((x) => [x.role_name, x.permission_key])),
    };
  });

  app.post('/import', { preHandler: app.requirePermission('admin:import') }, async (req) => {
    const files: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        files[part.fieldname] = (await part.toBuffer()).toString('utf8');
      }
    }

    const report = {
      users: emptyReport(),
      groups: emptyReport(),
      roles: emptyReport(),
      group_members: emptyReport(),
      group_roles: emptyReport(),
      role_permissions: emptyReport(),
    };
    const tempPasswords: { email: string; password: string }[] = [];
    const actor = actorId(req);

    // 1. Entities first (dependency order), so joins can resolve by natural key.
    if (files.users) {
      const recs = parseCsvRecords(files.users);
      for (const r of recs) {
        const [existing] = await db`SELECT id FROM users WHERE email = ${r.email}`;
        if (existing) {
          report.users.skipped++;
          continue;
        }
        const password = randomBytes(9).toString('base64url');
        const passwordHash = await bcrypt.hash(password, 10);
        const [u] = await db<{ id: string }[]>`
          INSERT INTO users (name, email, password_hash, status)
          VALUES (${r.name || null}, ${r.email}, ${passwordHash}, ${r.status || 'active'})
          RETURNING id`;
        tempPasswords.push({ email: r.email, password });
        await writeAudit(db, {
          actorId: actor,
          action: 'user.created',
          targetType: 'user',
          targetId: u.id,
          op: 'create',
          after: { name: r.name, email: r.email, status: r.status || 'active' },
          source: 'import',
        });
        report.users.created++;
      }
    }

    for (const [file, table, col] of [
      ['groups', 'groups', 'name'],
      ['roles', 'roles', 'name'],
    ] as const) {
      if (!files[file]) continue;
      for (const r of parseCsvRecords(files[file])) {
        const [existing] = await db`SELECT id FROM ${db(table)} WHERE ${db(col)} = ${r[col]}`;
        if (existing) {
          report[file].skipped++;
          continue;
        }
        const [row] = await db<{ id: string }[]>`
          INSERT INTO ${db(table)} (name, description)
          VALUES (${r.name}, ${r.description || null}) RETURNING id`;
        await writeAudit(db, {
          actorId: actor,
          action: `${table === 'groups' ? 'group' : 'role'}.created`,
          targetType: table === 'groups' ? 'group' : 'role',
          targetId: row.id,
          op: 'create',
          after: { name: r.name, description: r.description ?? null },
          source: 'import',
        });
        report[file].created++;
      }
    }

    // 2. Join tables, resolving entities by natural key.
    if (files.group_members) {
      const recs = parseCsvRecords(files.group_members);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const [u] = await db<{ id: string }[]>`SELECT id FROM users WHERE email = ${r.user_email}`;
        const [g] = await db<{ id: string }[]>`SELECT id FROM groups WHERE name = ${r.group_name}`;
        if (!u || !g) {
          report.group_members.errors.push({ row: i, reason: !u ? `user not found: ${r.user_email}` : `group not found: ${r.group_name}` });
          continue;
        }
        const [link] = await db`SELECT 1 AS x FROM group_members WHERE user_id = ${u.id} AND group_id = ${g.id}`;
        if (link) {
          report.group_members.skipped++;
          continue;
        }
        await db`INSERT INTO group_members (user_id, group_id) VALUES (${u.id}, ${g.id})`;
        await writeAudit(db, {
          actorId: actor,
          action: 'group.member.added',
          targetType: 'group',
          targetId: g.id,
          op: 'link.add',
          after: { table: 'group_members', user_id: u.id, group_id: g.id },
          source: 'import',
        });
        report.group_members.created++;
      }
    }

    if (files.group_roles) {
      const recs = parseCsvRecords(files.group_roles);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const [g] = await db<{ id: string }[]>`SELECT id FROM groups WHERE name = ${r.group_name}`;
        const [role] = await db<{ id: string }[]>`SELECT id FROM roles WHERE name = ${r.role_name}`;
        if (!g || !role) {
          report.group_roles.errors.push({ row: i, reason: !g ? `group not found: ${r.group_name}` : `role not found: ${r.role_name}` });
          continue;
        }
        const [link] = await db`SELECT 1 AS x FROM group_roles WHERE group_id = ${g.id} AND role_id = ${role.id}`;
        if (link) {
          report.group_roles.skipped++;
          continue;
        }
        await db`INSERT INTO group_roles (group_id, role_id) VALUES (${g.id}, ${role.id})`;
        report.group_roles.created++;
      }
    }

    if (files.role_permissions) {
      const recs = parseCsvRecords(files.role_permissions);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const [role] = await db<{ id: string }[]>`SELECT id FROM roles WHERE name = ${r.role_name}`;
        const [perm] = await db<{ id: string }[]>`SELECT id FROM permissions WHERE key = ${r.permission_key}`;
        if (!role || !perm) {
          report.role_permissions.errors.push({ row: i, reason: !role ? `role not found: ${r.role_name}` : `permission not found: ${r.permission_key}` });
          continue;
        }
        const [link] = await db`SELECT 1 AS x FROM role_permissions WHERE role_id = ${role.id} AND permission_id = ${perm.id}`;
        if (link) {
          report.role_permissions.skipped++;
          continue;
        }
        await db`INSERT INTO role_permissions (role_id, permission_id) VALUES (${role.id}, ${perm.id})`;
        report.role_permissions.created++;
      }
    }

    return { report, tempPasswords };
  });
};

export default importExportRoutes;
