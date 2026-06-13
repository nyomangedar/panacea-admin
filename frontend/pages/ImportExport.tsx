import { useState, type FormEvent } from 'react';
import { Button } from '@panacea/ui';

const FILES = ['users', 'groups', 'roles', 'group_members', 'group_roles', 'role_permissions'] as const;
type FileKey = (typeof FILES)[number];

interface EntityReport {
  created: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}
type Report = Record<FileKey, EntityReport>;
interface TempPassword {
  email: string;
  password: string;
}

export function ImportExport() {
  const [bundle, setBundle] = useState<Record<string, string> | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [tempPasswords, setTempPasswords] = useState<TempPassword[]>([]);

  async function onExport() {
    const res = await fetch('/api/admin/export', { credentials: 'include' });
    setBundle(await res.json());
  }

  async function onImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData();
    for (const name of FILES) {
      const input = form.elements.namedItem(name) as HTMLInputElement | null;
      const file = input?.files?.[0];
      if (file) fd.append(name, file);
    }
    const res = await fetch('/api/admin/import', { method: 'POST', credentials: 'include', body: fd });
    const data = (await res.json()) as { report: Report; tempPasswords: TempPassword[] };
    setReport(data.report);
    setTempPasswords(data.tempPasswords ?? []);
  }

  return (
    <div className="import-export">
      <section>
        <h3>Export</h3>
        <Button onClick={onExport}>Export</Button>
        {bundle && (
          <ul>
            {FILES.map((f) => (
              <li key={f}>
                <a download={`${f}.csv`} href={`data:text/csv,${encodeURIComponent(bundle[f] ?? '')}`}>
                  {f}.csv
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Import</h3>
        <form onSubmit={onImport}>
          {FILES.map((f) => (
            <label key={f}>
              {f}
              <input type="file" name={f} aria-label={f} />
            </label>
          ))}
          <Button type="submit">Import</Button>
        </form>

        {report && (
          <div data-testid="report">
            {FILES.map((f) => (
              <p key={f}>
                {f}: created {report[f].created}, skipped {report[f].skipped}, errors{' '}
                {report[f].errors.length}
              </p>
            ))}
          </div>
        )}

        {tempPasswords.length > 0 && (
          <div data-testid="temp-passwords">
            <h4>Temporary passwords (shown once)</h4>
            <ul>
              {tempPasswords.map((t) => (
                <li key={t.email}>
                  {t.email}: {t.password}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
