import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from 'postgres';
import bcrypt from 'bcryptjs';
import { writeAudit } from '@panacea/shared';
import { actorId, isUniqueViolation } from '../util.js';
import { uiContext, NotFoundError } from '../domain/context.js';
import { updateUser, setUserStatus } from '../domain/users.js';

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
      try {
        const user = await updateUser(uiContext(app, db, req), { id, changes });
        return { user };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'User not found' });
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
      try {
        const user = await setUserStatus(uiContext(app, db, req), { id, status: 'inactive' });
        return { user };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'User not found' });
        throw err;
      }
    },
  );

  app.post(
    '/users/:id/reactivate',
    { preHandler: app.requirePermission('admin:users:deactivate') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const user = await setUserStatus(uiContext(app, db, req), { id, status: 'active' });
        return { user };
      } catch (err) {
        if (err instanceof NotFoundError) return reply.status(404).send({ error: 'User not found' });
        throw err;
      }
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
      const groups = await db<{ id: string; name: string }[]>`
        SELECT g.id, g.name FROM group_members gm
        JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = ${id} ORDER BY g.name`;
      return { user, groups };
    },
  );
};

export default usersRoutes;
