import { useState } from 'react';
import { Button, Card, Modal } from '@panacea/ui';
import { useChangeHistory } from '../hooks/useChangeHistory.js';
import { useRevertChange, RevertConflictError } from '../hooks/useRevertChange.js';

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// 'user.updated' -> 'User updated'
function actionLabel(action: string): string {
  const spaced = action.replace(/\./g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function timeLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

interface DiffRow {
  key: string;
  from: unknown;
  to: unknown;
}

function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): DiffRow[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].map((key) => ({ key, from: before?.[key], to: after?.[key] }));
}

// Right-hand change-history rail: each audited change is a Card with a field-level
// diff and a Revert action (disabled + explained when not revertible). The list
// scrolls independently; a 409 conflict surfaces as a blocking message in the modal.
const PAGE_SIZE = 8;

export function ChangeHistory({ targetType, targetId }: { targetType: string; targetId: string }) {
  const [page, setPage] = useState(1);
  const { data } = useChangeHistory(targetType, targetId, page, PAGE_SIZE);
  const revert = useRevertChange(targetType, targetId);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const conflict = revert.error instanceof RevertConflictError ? revert.error : null;

  return (
    <aside
      className="change-history"
      style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h3 style={{ margin: 0 }}>Change history</h3>

      <div
        className="history-scroll"
        style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: '75vh', paddingRight: 4 }}
      >
        {entries.length === 0 && (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>No changes yet.</p>
        )}

        {entries.map((e) => {
          const time = timeLabel(e.created_at);
          return (
            <div key={e.id} data-testid="history-entry">
              <Card
                title={actionLabel(e.action)}
                description={[e.source, time].filter(Boolean).join(' · ')}
                header={
                  e.reverts_id ? (
                    <span className="badge history-revert-of">revert of #{e.reverts_id.slice(0, 8)}</span>
                  ) : undefined
                }
                footer={
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!e.revertible}
                    title={e.revertible ? undefined : e.reason}
                    onClick={() => {
                      revert.reset();
                      setConfirmId(e.id);
                    }}
                  >
                    Revert
                  </Button>
                }
              >
                <div className="history-diff" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {diffRows(e.payload.before, e.payload.after).map((d) => (
                    <div key={d.key} className="diff-row">
                      <span className="diff-key" style={{ fontWeight: 600 }}>
                        {d.key}
                      </span>
                      {': '}
                      <span className="diff-from">{fmt(d.from)}</span>
                      {' → '}
                      <span className="diff-to" style={{ color: 'var(--color-text-primary)' }}>
                        {fmt(d.to)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          );
        })}
      </div>

      {total > PAGE_SIZE && (
        <div
          className="history-pager"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Revert change"
        description="Revert this change? A new audited entry will be recorded."
        footer={
          <Button
            variant="danger"
            loading={revert.isPending}
            onClick={() => confirmId && revert.mutate(confirmId, { onSuccess: () => setConfirmId(null) })}
          >
            Confirm revert
          </Button>
        }
      >
        {conflict && (
          <div role="alert" className="revert-conflict">
            {conflict.detail}
          </div>
        )}
      </Modal>
    </aside>
  );
}
