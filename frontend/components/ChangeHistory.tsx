import { useState } from 'react';
import { Button, Modal } from '@panacea/ui';
import { useChangeHistory } from '../hooks/useChangeHistory.js';
import { useRevertChange, RevertConflictError } from '../hooks/useRevertChange.js';

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
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

// One reusable change-history timeline for any entity (user/group/role). Renders each
// audited change as a field-level diff with a Revert action (disabled + explained when
// the change can't be reverted), and surfaces a 409 conflict as a blocking message.
export function ChangeHistory({ targetType, targetId }: { targetType: string; targetId: string }) {
  const { data } = useChangeHistory(targetType, targetId);
  const revert = useRevertChange(targetType, targetId);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const entries = data?.entries ?? [];
  const conflict = revert.error instanceof RevertConflictError ? revert.error : null;

  return (
    <section className="change-history">
      <h3>Change history</h3>
      <ul className="history-list">
        {entries.map((e) => (
          <li key={e.id} className="history-entry" data-testid="history-entry">
            <div className="history-meta">
              <span className="history-action">{e.action}</span>
              <span className="history-source">{e.source}</span>
              {e.reverts_id && (
                <span className="badge history-revert-of">revert of #{e.reverts_id.slice(0, 8)}</span>
              )}
            </div>
            <div className="history-diff">
              {diffRows(e.payload.before, e.payload.after).map((d) => (
                <div key={d.key} className="diff-row">
                  <span className="diff-key">{d.key}</span>{': '}
                  <span className="diff-from">{fmt(d.from)}</span>
                  {' → '}
                  <span className="diff-to">{fmt(d.to)}</span>
                </div>
              ))}
            </div>
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
          </li>
        ))}
      </ul>

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Revert change"
        description="Revert this change? A new audited entry will be recorded."
        footer={
          <Button
            variant="danger"
            loading={revert.isPending}
            onClick={() =>
              confirmId &&
              revert.mutate(confirmId, { onSuccess: () => setConfirmId(null) })
            }
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
    </section>
  );
}
