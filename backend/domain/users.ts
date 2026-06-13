import { writeAudit } from '@panacea/shared';
import type { DomainCtx } from './context.js';
import { NotFoundError } from './context.js';

export interface UserRow {
  id: string;
  name: string | null;
  email: string;
  status: string;
  created_at: string;
}

// Edit a user's name/email/status. Audited as { op:'update' } with the changed
// fields' before/after. Emits no event (matches the M3 PATCH route). Reused by revert
// to restore a prior field value.
export async function updateUser(
  ctx: DomainCtx,
  args: { id: string; changes: { name?: string; email?: string; status?: string } },
): Promise<UserRow> {
  const { db } = ctx;
  const { id, changes } = args;
  const [before] = await db<UserRow[]>`
    SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
  if (!before) throw new NotFoundError('User');

  const [user] = await db<UserRow[]>`
    UPDATE users SET ${db({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.email !== undefined ? { email: changes.email } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
    })}
    WHERE id = ${id}
    RETURNING id, name, email, status, created_at`;

  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    op: 'update',
    before: { name: before.name, email: before.email, status: before.status },
    after: { name: user.name, email: user.email, status: user.status },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  return user;
}

// Activate or deactivate a user. Audited as { op:'update' } on status and emits the
// matching lifecycle event. Reused by revert (reverting a deactivate reactivates).
export async function setUserStatus(
  ctx: DomainCtx,
  args: { id: string; status: 'active' | 'inactive' },
): Promise<UserRow> {
  const { db } = ctx;
  const { id, status } = args;
  const [before] = await db<UserRow[]>`
    SELECT id, name, email, status, created_at FROM users WHERE id = ${id}`;
  if (!before) throw new NotFoundError('User');

  const [user] = await db<UserRow[]>`
    UPDATE users SET status = ${status} WHERE id = ${id}
    RETURNING id, name, email, status, created_at`;

  const deactivating = status === 'inactive';
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: deactivating ? 'user.deactivated' : 'user.reactivated',
    targetType: 'user',
    targetId: id,
    op: 'update',
    before: { status: before.status },
    after: { status },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent(deactivating ? 'user.deactivated' : 'user.reactivated', { id });
  return user;
}
