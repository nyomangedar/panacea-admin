import { useMutation, useQueryClient } from '@tanstack/react-query';

// Mirrors the backend 409 body so the UI can render a blocking explanation.
export class RevertConflictError extends Error {
  constructor(
    public conflict: string,
    public detail: string,
  ) {
    super(detail);
    this.name = 'RevertConflictError';
  }
}

async function postRevert(logId: string): Promise<unknown> {
  const res = await fetch(`/api/admin/audit-logs/${logId}/revert`, {
    method: 'POST',
    credentials: 'include',
  });
  if (res.status === 409) {
    const body = (await res.json()) as { conflict: string; detail: string };
    throw new RevertConflictError(body.conflict, body.detail);
  }
  if (!res.ok) throw new Error(`revert failed: ${res.status}`);
  return res.json();
}

// Revert a single audit entry, then refresh the entity and its history. The entity
// detail and history queries share the ['admin', targetType, targetId] prefix, so a
// single prefix invalidation covers both.
export function useRevertChange(targetType: string, targetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) => postRevert(logId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', targetType, targetId] });
    },
  });
}
