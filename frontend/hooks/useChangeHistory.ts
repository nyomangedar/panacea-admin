import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api.js';

export interface HistoryEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: {
    op: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  };
  source: string;
  reverts_id: string | null;
  created_at: string;
  revertible: boolean;
  reason?: string;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// Per-entity change history: the audit log filtered to one target, with each row
// enriched (revertible + reason) by the backend. Keyed under the entity so a revert
// can invalidate the entity and its history together.
export function useChangeHistory(targetType: string, targetId: string) {
  return useQuery({
    queryKey: ['admin', targetType, targetId, 'history'],
    queryFn: () =>
      apiGet<HistoryPage>(
        `/api/admin/audit-logs?target_type=${targetType}&target_id=${targetId}`,
      ),
    enabled: !!targetId,
  });
}
