import type { FastifyPluginAsync } from 'fastify';
import type { Sql, PendingQuery, Row } from 'postgres';

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: unknown;
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
        source?: string;
      };
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
      const offset = (page - 1) * pageSize;

      const conds: PendingQuery<Row[]>[] = [];
      if (q.actor) conds.push(db`actor_id = ${q.actor}`);
      if (q.action) conds.push(db`action = ${q.action}`);
      if (q.target) conds.push(db`target_id = ${q.target}`);
      if (q.source) conds.push(db`source = ${q.source}`);
      const where = conds.length
        ? db`WHERE ${conds.reduce((acc, c) => db`${acc} AND ${c}`)}`
        : db``;

      const entries = await db<AuditRow[]>`
        SELECT id, actor_id, action, target_type, target_id, payload, source, reverts_id, created_at
        FROM audit_logs ${where}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`;
      const [{ count }] = await db<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM audit_logs ${where}`;

      return { entries, total: Number(count), page, pageSize };
    },
  );
};

export default auditRoutes;
