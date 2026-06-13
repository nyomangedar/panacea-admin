import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { writeAudit } from '@panacea/shared';
import { actorId, isUniqueViolation } from '../util.js';
import { uiContext } from '../domain/context.js';
import { addRolePermission, removeRolePermission, addGroupRole } from '../domain/roles.js';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
}

const createBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
  },
};

const assignPermBody = {
  type: 'object',
  required: ['permissionId'],
  additionalProperties: false,
  properties: { permissionId: { type: 'string', minLength: 1 } },
};

const assignRoleBody = {
  type: 'object',
  required: ['roleId'],
  additionalProperties: false,
  properties: { roleId: { type: 'string', minLength: 1 } },
};

const rolesRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  app.get('/roles', { preHandler: app.requirePermission('admin:roles:read') }, async () => {
    const roles = await db<(RoleRow & { permissions: string[] })[]>`
      SELECT r.id, r.name, r.description,
             COALESCE(json_agg(p.key) FILTER (WHERE p.key IS NOT NULL), '[]') AS permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.name`;
    return { roles };
  });

  app.post(
    '/roles',
    { schema: { body: createBody }, preHandler: app.requirePermission('admin:roles:manage') },
    async (req, reply) => {
      const { name, description } = req.body as { name: string; description?: string };
      try {
        const [role] = await db<RoleRow[]>`
          INSERT INTO roles (name, description) VALUES (${name}, ${description ?? null})
          RETURNING id, name, description`;
        await writeAudit(db, {
          actorId: actorId(req),
          action: 'role.created',
          targetType: 'role',
          targetId: role.id,
          op: 'create',
          after: { name: role.name, description: role.description },
          source: 'ui',
        });
        return reply.status(201).send({ role });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ error: 'Role name exists' });
        throw err;
      }
    },
  );

  app.post(
    '/roles/:id/permissions',
    { schema: { body: assignPermBody }, preHandler: app.requirePermission('admin:roles:assign') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { permissionId } = req.body as { permissionId: string };
      try {
        await addRolePermission(uiContext(app, db, req), { roleId: id, permissionId });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ error: 'Already assigned' });
        throw err;
      }
      return reply.status(201).send({ ok: true });
    },
  );

  app.delete(
    '/roles/:id/permissions/:permissionId',
    { preHandler: app.requirePermission('admin:roles:assign') },
    async (req) => {
      const { id, permissionId } = req.params as { id: string; permissionId: string };
      await removeRolePermission(uiContext(app, db, req), { roleId: id, permissionId });
      return { ok: true };
    },
  );

  app.post(
    '/groups/:id/roles',
    { schema: { body: assignRoleBody }, preHandler: app.requirePermission('admin:roles:assign') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { roleId } = req.body as { roleId: string };
      try {
        await addGroupRole(uiContext(app, db, req), { groupId: id, roleId });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ error: 'Already assigned' });
        throw err;
      }
      return reply.status(201).send({ ok: true });
    },
  );
};

export default rolesRoutes;
