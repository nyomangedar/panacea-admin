import { writeAudit } from '@panacea/shared';
import type { DomainCtx } from './context.js';

// Assign a role to a group. Audited as { op:'link.add' } on the group; emits group.updated.
export async function addGroupRole(
  ctx: DomainCtx,
  args: { groupId: string; roleId: string },
): Promise<void> {
  const { db } = ctx;
  const { groupId, roleId } = args;
  await db`INSERT INTO group_roles (group_id, role_id) VALUES (${groupId}, ${roleId})`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'group.role.added',
    targetType: 'group',
    targetId: groupId,
    op: 'link.add',
    after: { table: 'group_roles', group_id: groupId, role_id: roleId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent('group.updated', { id: groupId, action: 'role.added' });
}

// Remove a role from a group. Audited as { op:'link.remove' }; emits group.updated.
// No M3 route uses this directly — it exists so revert can undo a group.role.added.
export async function removeGroupRole(
  ctx: DomainCtx,
  args: { groupId: string; roleId: string },
): Promise<void> {
  const { db } = ctx;
  const { groupId, roleId } = args;
  await db`DELETE FROM group_roles WHERE group_id = ${groupId} AND role_id = ${roleId}`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'group.role.removed',
    targetType: 'group',
    targetId: groupId,
    op: 'link.remove',
    before: { table: 'group_roles', group_id: groupId, role_id: roleId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent('group.updated', { id: groupId, action: 'role.removed' });
}

// Assign a permission to a role. Audited as { op:'link.add' } on the role.
export async function addRolePermission(
  ctx: DomainCtx,
  args: { roleId: string; permissionId: string },
): Promise<void> {
  const { db } = ctx;
  const { roleId, permissionId } = args;
  await db`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${permissionId})`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'role.permission.added',
    targetType: 'role',
    targetId: roleId,
    op: 'link.add',
    after: { table: 'role_permissions', role_id: roleId, permission_id: permissionId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
}

// Remove a permission from a role. Audited as { op:'link.remove' } on the role.
export async function removeRolePermission(
  ctx: DomainCtx,
  args: { roleId: string; permissionId: string },
): Promise<void> {
  const { db } = ctx;
  const { roleId, permissionId } = args;
  await db`DELETE FROM role_permissions WHERE role_id = ${roleId} AND permission_id = ${permissionId}`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'role.permission.removed',
    targetType: 'role',
    targetId: roleId,
    op: 'link.remove',
    before: { table: 'role_permissions', role_id: roleId, permission_id: permissionId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
}
