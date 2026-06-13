import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import type { AuditSource } from '@panacea/shared';
import { actorId } from '../util.js';

// Shared context for every domain mutation. Carries the db, a publishEvent sink,
// the acting user, and the audit provenance (source + optional revertsId). Both the
// route handlers (source: 'ui' / 'import') and the revert engine (source: 'revert',
// revertsId set) call the same domain functions through this context — one write path.
export interface DomainCtx {
  db: Sql;
  publishEvent: (event: string, payload?: unknown) => void | Promise<void>;
  actorId: string | null;
  source?: AuditSource;
  revertsId?: string | null;
}

// Raised by a domain mutation when its target row does not exist. Routes map this to
// a 404; the revert engine maps it to a 409 entity_missing conflict.
export class NotFoundError extends Error {
  constructor(public entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

// Build a UI-sourced context from a Fastify request (the common route case).
export function uiContext(app: FastifyInstance, db: Sql, req: FastifyRequest): DomainCtx {
  return { db, publishEvent: app.publishEvent, actorId: actorId(req), source: 'ui' };
}
