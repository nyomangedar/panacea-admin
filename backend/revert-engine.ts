import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import type { AuditOp } from '@panacea/shared';
import type { DomainCtx } from './domain/context.js';
import { updateUser, setUserStatus } from './domain/users.js';
import { updateGroup, addGroupMember, removeGroupMember } from './domain/groups.js';
import { addGroupRole, removeGroupRole, addRolePermission, removeRolePermission } from './domain/roles.js';

export type RevertConflict = 'changed_since' | 'entity_missing' | 'unsupported';

// Thrown when a change cannot be reverted. The route maps this to a 409 with the
// `conflict` code and `detail` message.
export class RevertConflictError extends Error {
  constructor(
    public conflict: RevertConflict,
    public detail: string,
  ) {
    super(detail);
    this.name = 'RevertConflictError';
  }
}

interface AuditPayload {
  op: AuditOp;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

// The (action) values the engine knows how to invert, grouped by op. Kept beside the
// dispatch below so revertability() and revertChange() never disagree.
const REVERTIBLE_ACTIONS = new Set<string>([
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'group.updated',
  'group.member.added',
  'group.member.removed',
  'group.role.added',
  'group.role.removed',
  'role.permission.added',
  'role.permission.removed',
]);

// Whether an audit entry can be reverted, and why not when it can't. Used to enrich
// history rows so the UI can disable the Revert button with an explanation.
export function revertability(op: AuditOp, action: string): { revertible: boolean; reason?: string } {
  if (op === 'create' || op === 'delete') {
    return { revertible: false, reason: `A ${op} cannot be reverted` };
  }
  if (REVERTIBLE_ACTIONS.has(action)) return { revertible: true };
  return { revertible: false, reason: `"${action}" cannot be reverted` };
}

export interface AuditEntryRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: AuditPayload;
  source: string;
  reverts_id: string | null;
  created_at: string;
}

const ENTRY_COLS = (db: Sql) => db`
  id, action, target_type, target_id, payload, source, reverts_id, created_at`;

// Revert a single audited change. Loads the entry, conflict-checks the current state
// against the entry's `after`, then applies the inverse through the SAME domain
// mutation a normal edit uses (with source='revert' and reverts_id set) — so the
// revert is itself audited, validated, and event-emitting. Returns the new entry.
export async function revertChange(
  db: Sql,
  app: FastifyInstance,
  logId: string,
  actor: string | null,
): Promise<AuditEntryRow> {
  const [entry] = await db<AuditEntryRow[]>`
    SELECT ${ENTRY_COLS(db)} FROM audit_logs WHERE id = ${logId}`;
  if (!entry) throw new RevertConflictError('unsupported', 'Audit entry not found');

  const ctx: DomainCtx = {
    db,
    publishEvent: app.publishEvent,
    actorId: actor,
    source: 'revert',
    revertsId: logId,
  };

  const { op } = entry.payload;
  if (op === 'create' || op === 'delete') {
    throw new RevertConflictError('unsupported', `Cannot revert a ${op}`);
  } else if (op === 'update') {
    await revertUpdate(db, ctx, entry);
  } else if (op === 'link.add') {
    await revertLinkAdd(db, ctx, entry);
  } else if (op === 'link.remove') {
    await revertLinkRemove(db, ctx, entry);
  } else {
    throw new RevertConflictError('unsupported', `Unknown op ${String(op)}`);
  }

  const [created] = await db<AuditEntryRow[]>`
    SELECT ${ENTRY_COLS(db)} FROM audit_logs
    WHERE reverts_id = ${logId} ORDER BY created_at DESC LIMIT 1`;
  return created;
}

// ---- update reverts: restore `before` after confirming current state == `after` ----

async function revertUpdate(db: Sql, ctx: DomainCtx, entry: AuditEntryRow): Promise<void> {
  const id = entry.target_id as string;
  const before = entry.payload.before ?? {};
  const after = entry.payload.after ?? {};

  switch (entry.action) {
    case 'user.updated': {
      await assertRowMatches(db, 'users', id, after);
      await updateUser(ctx, { id, changes: before as { name?: string; email?: string; status?: string } });
      return;
    }
    case 'user.deactivated':
    case 'user.reactivated': {
      await assertRowMatches(db, 'users', id, after);
      await setUserStatus(ctx, { id, status: before.status as 'active' | 'inactive' });
      return;
    }
    case 'group.updated': {
      await assertRowMatches(db, 'groups', id, after);
      await updateGroup(ctx, { id, changes: before as { name?: string; description?: string } });
      return;
    }
    default:
      throw new RevertConflictError('unsupported', `Cannot revert update action ${entry.action}`);
  }
}

// ---- link.add reverts: remove the link (after confirming it still exists) ----

async function revertLinkAdd(db: Sql, ctx: DomainCtx, entry: AuditEntryRow): Promise<void> {
  const after = entry.payload.after ?? {};
  switch (entry.action) {
    case 'group.member.added': {
      const groupId = after.group_id as string;
      const userId = after.user_id as string;
      await assertLinkPresent(db, 'group_members', { group_id: groupId, user_id: userId });
      await removeGroupMember(ctx, { groupId, userId });
      return;
    }
    case 'group.role.added': {
      const groupId = after.group_id as string;
      const roleId = after.role_id as string;
      await assertLinkPresent(db, 'group_roles', { group_id: groupId, role_id: roleId });
      await removeGroupRole(ctx, { groupId, roleId });
      return;
    }
    case 'role.permission.added': {
      const roleId = after.role_id as string;
      const permissionId = after.permission_id as string;
      await assertLinkPresent(db, 'role_permissions', { role_id: roleId, permission_id: permissionId });
      await removeRolePermission(ctx, { roleId, permissionId });
      return;
    }
    default:
      throw new RevertConflictError('unsupported', `Cannot revert link.add action ${entry.action}`);
  }
}

// ---- link.remove reverts: re-add the link (confirm it is absent + targets exist) ----

async function revertLinkRemove(db: Sql, ctx: DomainCtx, entry: AuditEntryRow): Promise<void> {
  const before = entry.payload.before ?? {};
  switch (entry.action) {
    case 'group.member.removed': {
      const groupId = before.group_id as string;
      const userId = before.user_id as string;
      await assertLinkAbsent(db, 'group_members', { group_id: groupId, user_id: userId });
      await assertEntityExists(db, 'groups', groupId);
      await assertEntityExists(db, 'users', userId);
      await addGroupMember(ctx, { groupId, userId });
      return;
    }
    case 'group.role.removed': {
      const groupId = before.group_id as string;
      const roleId = before.role_id as string;
      await assertLinkAbsent(db, 'group_roles', { group_id: groupId, role_id: roleId });
      await assertEntityExists(db, 'groups', groupId);
      await assertEntityExists(db, 'roles', roleId);
      await addGroupRole(ctx, { groupId, roleId });
      return;
    }
    case 'role.permission.removed': {
      const roleId = before.role_id as string;
      const permissionId = before.permission_id as string;
      await assertLinkAbsent(db, 'role_permissions', { role_id: roleId, permission_id: permissionId });
      await assertEntityExists(db, 'roles', roleId);
      await assertEntityExists(db, 'permissions', permissionId);
      await addRolePermission(ctx, { roleId, permissionId });
      return;
    }
    default:
      throw new RevertConflictError('unsupported', `Cannot revert link.remove action ${entry.action}`);
  }
}

// ---- conflict checks ----

async function assertRowMatches(
  db: Sql,
  table: 'users' | 'groups',
  id: string,
  after: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(after);
  const [row] = await db<Record<string, unknown>[]>`
    SELECT ${db(cols)} FROM ${db(table)} WHERE id = ${id}`;
  if (!row) throw new RevertConflictError('changed_since', 'Target no longer exists');
  for (const k of cols) {
    if (row[k] !== after[k]) {
      throw new RevertConflictError('changed_since', `Field "${k}" changed since this version`);
    }
  }
}

async function linkCount(db: Sql, table: string, cols: Record<string, string>): Promise<number> {
  const conds = Object.entries(cols).map(([c, v]) => db`${db(c)} = ${v}`);
  const where = conds.reduce((acc, c) => db`${acc} AND ${c}`);
  const [{ count }] = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM ${db(table)} WHERE ${where}`;
  return Number(count);
}

async function assertLinkPresent(db: Sql, table: string, cols: Record<string, string>): Promise<void> {
  if ((await linkCount(db, table, cols)) === 0) {
    throw new RevertConflictError('changed_since', `${table} link no longer exists`);
  }
}

async function assertLinkAbsent(db: Sql, table: string, cols: Record<string, string>): Promise<void> {
  if ((await linkCount(db, table, cols)) > 0) {
    throw new RevertConflictError('changed_since', `${table} link already exists`);
  }
}

async function assertEntityExists(db: Sql, table: string, id: string): Promise<void> {
  const [{ count }] = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM ${db(table)} WHERE id = ${id}`;
  if (Number(count) === 0) {
    throw new RevertConflictError('entity_missing', `Referenced ${table} no longer exists`);
  }
}
