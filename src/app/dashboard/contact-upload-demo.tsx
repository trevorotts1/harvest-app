'use client';

import { ChangeEvent, useMemo, useState } from 'react';

type DemoContact = {
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
};

type ImportResult = {
  imported: number;
  skipped: number;
  importedContacts?: DemoContact[];
  skippedContacts?: { name: string; reason: string }[];
  error?: string;
};

const sampleCsv = `name,phone,email,industry,notes\nMichelle Carter,312-555-0112,michelle@example.com,education,Former colleague\nAndre Bell,773-555-0188,andre@example.com,finance,Asked about building part-time income`;

function parseCsv(text: string): DemoContact[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const first = rows[0].toLowerCase();
  const hasHeader = first.includes('name') && (first.includes('email') || first.includes('phone'));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row) => {
      const [name = '', phone = '', email = '', industry = '', ...notesParts] = row
        .split(',')
        .map((cell) => cell.trim());
      return {
        name,
        phone,
        email,
        industry,
        notes: notesParts.join(', ').trim(),
      };
    })
    .filter((contact) => contact.name.length > 0);
}

export default function ContactUploadDemo() {
  const [rawContacts, setRawContacts] = useState(sampleCsv);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const parsedContacts = useMemo(() => parseCsv(rawContacts), [rawContacts]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRawContacts(await file.text());
    setResult(null);
  }

  async function importContacts() {
    setIsImporting(true);
    setResult(null);

    try {
      const response = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'demo-user',
        },
        body: JSON.stringify({ source: 'CSV', contacts: parsedContacts }),
      });
      const payload = (await response.json()) as ImportResult;
      setResult(response.ok ? payload : { ...payload, imported: 0, skipped: parsedContacts.length });
    } catch (error) {
      setResult({
        imported: 0,
        skipped: parsedContacts.length,
        error: error instanceof Error ? error.message : 'Import failed',
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="card panel" id="contact-upload">
      <div className="section-heading">
        <div>
          <span className="badge">Contact upload demo</span>
          <h3 style={{ marginTop: 12 }}>Upload or paste warm-market contacts</h3>
        </div>
        <span className="badge">{parsedContacts.length} parsed</span>
      </div>

      <p>
        For demo mode, contacts are parsed in the browser and sent to a safe in-memory import endpoint.
        Nothing is texted, emailed, charged, or synced externally.
      </p>

      <div className="field">
        <label htmlFor="contact-file">CSV file</label>
        <input id="contact-file" type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} />
      </div>

      <div className="field">
        <label htmlFor="contact-csv">Or paste CSV rows</label>
        <textarea
          id="contact-csv"
          rows={7}
          value={rawContacts}
          onChange={(event) => {
            setRawContacts(event.target.value);
            setResult(null);
          }}
        />
      </div>

      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn btn-primary" type="button" disabled={parsedContacts.length === 0 || isImporting} onClick={importContacts}>
          {isImporting ? 'Importing…' : 'Import contacts'}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => { setRawContacts(sampleCsv); setResult(null); }}>
          Reset sample
        </button>
      </div>

      {result ? (
        <div className={result.error ? 'notice notice-danger' : 'notice'} style={{ marginTop: 18 }}>
          {result.error ? (
            <strong>Import blocked: {result.error}</strong>
          ) : (
            <strong>Imported {result.imported} contact{result.imported === 1 ? '' : 's'} · Skipped {result.skipped}</strong>
          )}
        </div>
      ) : null}

      {parsedContacts.length > 0 ? (
        <div className="table-wrap" aria-label="Parsed contact preview">
          <table>
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Email</th><th>Industry</th></tr>
            </thead>
            <tbody>
              {parsedContacts.slice(0, 5).map((contact) => (
                <tr key={`${contact.name}-${contact.email || contact.phone}`}>
                  <td>{contact.name}</td>
                  <td>{contact.phone || '—'}</td>
                  <td>{contact.email || '—'}</td>
                  <td>{contact.industry || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
