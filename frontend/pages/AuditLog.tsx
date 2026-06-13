import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@panacea/ui';
import { apiGet } from '../api.js';

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  source: string;
  created_at: string;
  payload: unknown;
}
interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export function AuditLog() {
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'audit', { source, page }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (source) qs.set('source', source);
      qs.set('page', String(page));
      return apiGet<AuditPage>(`/api/admin/audit-logs?${qs.toString()}`);
    },
  });

  return (
    <div className="audit-log">
      <label>
        Source filter
        <select
          aria-label="Source filter"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPage(1);
          }}
        >
          <option value="">all</option>
          <option value="ui">ui</option>
          <option value="import">import</option>
        </select>
      </label>

      <table>
        <thead>
          <tr>
            <th>Actor</th>
            <th>Action</th>
            <th>Source</th>
            <th aria-label="details" />
          </tr>
        </thead>
        <tbody>
          {(data?.entries ?? []).map((e) => (
            <Fragment key={e.id}>
              <tr>
                <td>{e.actor_email}</td>
                <td>{e.action}</td>
                <td>{e.source}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    Details
                  </Button>
                </td>
              </tr>
              {expanded === e.id && (
                <tr>
                  <td colSpan={4}>
                    <pre data-testid="payload">{JSON.stringify(e.payload)}</pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="pager">
        <Button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Prev
        </Button>
        <span>Page {page}</span>
        <Button onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
    </div>
  );
}
