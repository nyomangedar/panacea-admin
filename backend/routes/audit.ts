import type { FastifyPluginAsync } from 'fastify';
import type { Sql, PendingQuery, Row } from 'postgres';
import { actorId } from '../util.js';
import { revertChange, revertability, RevertConflictError } from '../revert-engine.js';

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: { op: 'update' | 'link.add' | 'link.remove' | 'create' | 'delete' };
  source: string;
  reverts_id: string | null;
  created_at: string;
}

const auditRoutes: FastifyPluginAsync<{ db: Sql }> = async (app, { db }) => {
  app.get(
    '/audit-logs',
    { preHandler: app.requirePermission('admin:audit:read') },
    async (req) => {
      const q = req.query as {
        page?: string;
        pageSize?: string;
        actor?: string;
        action?: string;
        target?: string;
        target_type?: string;
        source?: string;
      };
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
      const offset = (page - 1) * pageSize;

      const conds: PendingQuery<Row[]>[] = [];
      if (q.actor) conds.push(db`actor_id = ${q.actor}`);
      if (q.action) conds.push(db`action = ${q.action}`);
      if (q.target) conds.push(db`target_id = ${q.target}`);
      if (q.target_type) conds.push(db`target_type = ${q.target_type}`);
      if (q.source) conds.push(db`source = ${q.source}`);
      const where = conds.length
        ? db`WHERE ${conds.reduce((acc, c) => db`${acc} AND ${c}`)}`
        : db``;

      const rows = await db<(AuditRow & { actor_email: string | null })[]>`
        SELECT al.id, al.actor_id, u.email AS actor_email, al.action, al.target_type,
               al.target_id, al.payload, al.source, al.reverts_id, al.created_at
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`;
      const [{ count }] = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM audit_logs ${where}`;

      // Enrich each row so the history UI can render/disable the Revert button.
      const entries = rows.map((r) => ({ ...r, ...revertability(r.payload.op, r.action) }));

      return { entries, total: Number(count), page, pageSize };
    },
  );

  app.post(
    '/audit-logs/:id/revert',
    { preHandler: app.requirePermission('admin:audit:revert') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      try {
        const entry = await revertChange(db, app, id, actorId(req));
        return { entry };
      } catch (err) {
        if (err instanceof RevertConflictError) {
          return reply.status(409).send({ conflict: err.conflict, detail: err.detail });
        }
        throw err;
      }
    },
  );
};

export default auditRoutes;
