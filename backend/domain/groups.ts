import { writeAudit } from '@panacea/shared';
import type { DomainCtx } from './context.js';
import { NotFoundError } from './context.js';

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

// Edit a group's name/description. Audited as { op:'update' }; emits group.updated.
export async function updateGroup(
  ctx: DomainCtx,
  args: { id: string; changes: { name?: string; description?: string } },
): Promise<GroupRow> {
  const { db } = ctx;
  const { id, changes } = args;
  const [before] = await db<GroupRow[]>`
    SELECT id, name, description, created_at FROM groups WHERE id = ${id}`;
  if (!before) throw new NotFoundError('Group');

  const [group] = await db<GroupRow[]>`
    UPDATE groups SET ${db({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
    })}
    WHERE id = ${id}
    RETURNING id, name, description, created_at`;

  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'group.updated',
    targetType: 'group',
    targetId: id,
    op: 'update',
    before: { name: before.name, description: before.description },
    after: { name: group.name, description: group.description },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent('group.updated', { id, action: 'updated' });
  return group;
}

// Add a user to a group. Audited as { op:'link.add' }; emits group.updated.
export async function addGroupMember(
  ctx: DomainCtx,
  args: { groupId: string; userId: string },
): Promise<void> {
  const { db } = ctx;
  const { groupId, userId } = args;
  await db`INSERT INTO group_members (user_id, group_id) VALUES (${userId}, ${groupId})`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'group.member.added',
    targetType: 'group',
    targetId: groupId,
    op: 'link.add',
    after: { table: 'group_members', user_id: userId, group_id: groupId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent('group.updated', { id: groupId, action: 'member.added' });
}

// Remove a user from a group. Audited as { op:'link.remove' }; emits group.updated.
export async function removeGroupMember(
  ctx: DomainCtx,
  args: { groupId: string; userId: string },
): Promise<void> {
  const { db } = ctx;
  const { groupId, userId } = args;
  await db`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}`;
  await writeAudit(db, {
    actorId: ctx.actorId,
    action: 'group.member.removed',
    targetType: 'group',
    targetId: groupId,
    op: 'link.remove',
    before: { table: 'group_members', user_id: userId, group_id: groupId },
    source: ctx.source,
    revertsId: ctx.revertsId,
  });
  await ctx.publishEvent('group.updated', { id: groupId, action: 'member.removed' });
}
