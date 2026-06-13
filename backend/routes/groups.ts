import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import { writeAudit } from '@panacea/shared';
import { actorId, isUniqueViolation } from '../util.js';
import { uiContext, NotFoundError } from '../domain/context.js';
import { updateGroup, addGroupMember, removeGroupMember } from '../domain/groups.js';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
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

const patchBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
  },
};

const memberBody = {
  type: 'object',
  required: ['userId'],
  additionalProperties: false,
  properties: { userId: { type: 'string', minLength: 1 } },
};

const groupsRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  app.get('/groups', { preHandler: app.requirePermission('admin:groups:read') }, async () => {
    const groups = await db<(GroupRow & { member_count: number })[]>`
      SELECT g.id, g.name, g.description, g.created_at,
             COUNT(gm.user_id)::int AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
      GROUP BY g.id
      ORDER BY g.created_at DESC`;
    return { groups };
  });

  app.get('/groups/:id', { preHandler: app.requirePermission('admin:groups:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [group] = await db<GroupRow[]>`
      SELECT id, name, description, created_at FROM groups WHERE id = ${id}`;
    if (!group) return reply.status(404).send({ error: 'Group not found' });
    const members = await db<{ id: string; name: string | null; email: string; status: string }[]>`
      SELECT u.id, u.name, u.email, u.status
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ${id} ORDER BY u.email`;
    const roles = await db<{ id: string; name: string }[]>`
      SELECT r.id, r.name FROM group_roles gr JOIN roles r ON r.id = gr.role_id
      WHERE gr.group_id = ${id} ORDER BY r.name`;
    return { group, members, roles };
  });

  app.post(
    '/groups',
    { schema: { body: createBody }, preHandler: app.requirePermission('admin:groups:manage') },
    async (req, reply) => {
      const { name, description } = req.body as { name: string; description?: string };
      try {
        const [group] = await db<GroupRow[]>`
          INSERT INTO groups (name, description) VALUES (${name}, ${description ?? null})
          RETURNING id, name, description, created_at`;
        await writeAudit(db, {
          actorId: actorId(req),
          action: 'group.created',
          targetType: 'group',
          targetId: group.id,
          op: 'create',
          after: { name: group.name, description: group.description },
          source: 'ui',
        });
        await app.publishEvent('group.updated', { id: group.id, action: 'created' });
        return reply.status(201).send({ group });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ error: 'Group name exists' });
        throw err;
      }
    },
  );

  app.patch(
    '/groups/:id',
    { schema: { body: patchBody }, preHandler: app.requirePermission('admin:groups:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const changes = req.body as { name?: string; description?: string };
      try {
        const group = await updateGroup(uiContext(app, db, req), { id, changes });
        return { group };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'Group not found' });
        throw err;
      }
    },
  );

  app.delete(
    '/groups/:id',
    { preHandler: app.requirePermission('admin:groups:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [{ count }] = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM group_members WHERE group_id = ${id}`;
      if (Number(count) > 0) {
        return reply.status(409).send({ error: 'Group has members' });
      }
      const deleted = await db<GroupRow[]>`
        DELETE FROM groups WHERE id = ${id} RETURNING id, name, description, created_at`;
      if (deleted.length === 0) return reply.status(404).send({ error: 'Group not found' });
      await writeAudit(db, {
        actorId: actorId(req),
        action: 'group.deleted',
        targetType: 'group',
        targetId: id,
        op: 'delete',
        before: { name: deleted[0].name, description: deleted[0].description },
        source: 'ui',
      });
      return { ok: true };
    },
  );

  app.post(
    '/groups/:id/members',
    { schema: { body: memberBody }, preHandler: app.requirePermission('admin:groups:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userId } = req.body as { userId: string };
      try {
        await addGroupMember(uiContext(app, db, req), { groupId: id, userId });
      } catch (err) {
        if (isUniqueViolation(err)) return reply.status(409).send({ error: 'Already a member' });
        throw err;
      }
      return reply.status(201).send({ ok: true });
    },
  );

  app.delete(
    '/groups/:id/members/:userId',
    { preHandler: app.requirePermission('admin:groups:manage') },
    async (req) => {
      const { id, userId } = req.params as { id: string; userId: string };
      await removeGroupMember(uiContext(app, db, req), { groupId: id, userId });
      return { ok: true };
    },
  );
};

export default groupsRoutes;
