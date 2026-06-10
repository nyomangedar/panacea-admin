import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import bcrypt from 'bcryptjs';
import { writeAudit } from '@panacea/shared';
import { actorId, isUniqueViolation } from '../util.js';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  status: string;
  created_at: string;
}

const createBody = {
  type: 'object',
  required: ['name', 'email', 'password'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 3 },
    password: { type: 'string', minLength: 8 },
  },
};

const patchBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 3 },
    status: { type: 'string', enum: ['active', 'inactive'] },
  },
};

const usersRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  app.post(
    '/users',
    { schema: { body: createBody }, preHandler: app.requirePermission('admin:users:create') },
    async (req, reply) => {
      const { name, email, password } = req.body as {
        name: string;
        email: string;
        password: string;
      };
      const passwordHash = await bcrypt.hash(password, 10);
      try {
        const [user] = await db<UserRow[]>`
          INSERT INTO users (name, email, password_hash, status)
          VALUES (${name}, ${email}, ${passwordHash}, 'active')
          RETURNING id, name, email, status, created_at`;
        await writeAudit(db, {
          actorId: actorId(req),
          action: 'user.created',
          targetType: 'user',
          targetId: user.id,
          op: 'create',
          after: { name: user.name, email: user.email, status: user.status },
          source: 'ui',
        });
        await app.publishEvent('user.created', { id: user.id, email: user.email });
        return reply.status(201).send({ user });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.status(409).send({ error: 'Email already exists' });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/users/:id',
    { schema: { body: patchBody }, preHandler: app.requirePermission('admin:users:update') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const changes = req.body as { name?: string; email?: string; status?: string };

      const [before] = await db<UserRow[]>`
        SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
      if (!before) return reply.status(404).send({ error: 'User not found' });

      try {
        const [user] = await db<UserRow[]>`
          UPDATE users SET ${db({
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.email !== undefined ? { email: changes.email } : {}),
            ...(changes.status !== undefined ? { status: changes.status } : {}),
          })}
          WHERE id = ${id}
          RETURNING id, name, email, status, created_at`;
        await writeAudit(db, {
          actorId: actorId(req),
          action: 'user.updated',
          targetType: 'user',
          targetId: id,
          op: 'update',
          before: { name: before.name, email: before.email, status: before.status },
          after: { name: user.name, email: user.email, status: user.status },
          source: 'ui',
        });
        return { user };
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.status(409).send({ error: 'Email already exists' });
        }
        throw err;
      }
    },
  );

  app.get(
    '/users',
    { preHandler: app.requirePermission('admin:users:read') },
    async (req) => {
      const q = req.query as { page?: string; pageSize?: string; status?: string; group?: string };
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
      const offset = (page - 1) * pageSize;

      const groupJoin = q.group
        ? db`JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ${q.group}`
        : db``;
      const statusWhere = q.status ? db`WHERE u.status = ${q.status}` : db``;

      const users = await db<UserRow[]>`
        SELECT u.id, u.name, u.email, u.status, u.created_at
        FROM users u ${groupJoin} ${statusWhere}
        ORDER BY u.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`;
      const [{ count }] = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM users u ${groupJoin} ${statusWhere}`;

      return { users, total: Number(count), page, pageSize };
    },
  );

  app.post(
    '/users/:id/deactivate',
    { preHandler: app.requirePermission('admin:users:deactivate') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [before] = await db<UserRow[]>`
        SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
      if (!before) return reply.status(404).send({ error: 'User not found' });

      const [user] = await db<UserRow[]>`
        UPDATE users SET status = 'inactive' WHERE id = ${id}
        RETURNING id, name, email, status, created_at`;
      await writeAudit(db, {
        actorId: actorId(req),
        action: 'user.deactivated',
        targetType: 'user',
        targetId: id,
        op: 'update',
        before: { status: before.status },
        after: { status: 'inactive' },
        source: 'ui',
      });
      await app.publishEvent('user.deactivated', { id });
      return { user };
    },
  );

  app.post(
    '/users/:id/reactivate',
    { preHandler: app.requirePermission('admin:users:deactivate') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [before] = await db<UserRow[]>`
        SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
      if (!before) return reply.status(404).send({ error: 'User not found' });

      const [user] = await db<UserRow[]>`
        UPDATE users SET status = 'active' WHERE id = ${id}
        RETURNING id, name, email, status, created_at`;
      await writeAudit(db, {
        actorId: actorId(req),
        action: 'user.reactivated',
        targetType: 'user',
        targetId: id,
        op: 'update',
        before: { status: before.status },
        after: { status: 'active' },
        source: 'ui',
      });
      await app.publishEvent('user.reactivated', { id });
      return { user };
    },
  );

  app.get(
    '/users/:id',
    { preHandler: app.requirePermission('admin:users:read') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [user] = await db<UserRow[]>`
        SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
      if (!user) return reply.status(404).send({ error: 'User not found' });
      return { user };
    },
  );
};

export default usersRoutes;
