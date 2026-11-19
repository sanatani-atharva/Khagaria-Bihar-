import { FileText, ImageIcon, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EvidenceMeta } from '../../core/types';
import { fmtDateTime } from '../lib/format';
import { readEvidence, type EvidencePayload } from '../lib/files';
import { useQ } from '../lib/hooks';
import { Badge, Button, Modal, Skeleton, cx } from './ui';

/** File picker for evidence of resolution (photo / PDF), with camera capture on phones. */
export function EvidencePicker({ value, onChange }: { value: EvidencePayload | null; onChange: (v: EvidencePayload | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        aria-label="Choose evidence file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setErr(null);
          setBusy(true);
          try {
            onChange(await readEvidence(f));
          } catch (x) {
            setErr((x as Error).message);
            onChange(null);
          } finally {
            setBusy(false);
          }
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-subtle p-2">
          {value.mime.startsWith('image/') ? (
            <img src={value.dataUrl} alt="Selected evidence preview" className="size-16 rounded object-cover" />
          ) : (
            <FileText className="size-10 text-ink-3" aria-hidden />
          )}
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="truncate font-semibold">{value.fileName}</div>
            <div className="text-ink-3">{(value.size / 1024).toFixed(0)} KB · {value.mime}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon={<Upload className="size-4" />} loading={busy} onClick={() => ref.current?.click()}>
          Attach photo or PDF
        </Button>
      )}
      <p className="text-xs text-ink-3">Geo-tagged photo, measurement sheet or order copy. Photos are compressed to WebP before upload (max 2.5 MB).</p>
      {err && (
        <p role="alert" className="text-xs font-semibold text-bad">
          {err}
        </p>
      )}
    </div>
  );
}

const REVIEW_TONE = { pending: 'warn', accepted: 'ok', rejected: 'bad' } as const;
const REVIEW_LABEL = { pending: 'Awaiting verification', accepted: 'Verified', rejected: 'Rejected' } as const;

/** List of evidence items; clicking opens the full file (fetched on demand). */
export function EvidenceList({ items }: { items: EvidenceMeta[] }) {
  const [open, setOpen] = useState<EvidenceMeta | null>(null);
  if (!items.length) return <p className="text-[13px] text-ink-3">No evidence uploaded yet.</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-white p-2.5">
            <button className="grid size-12 shrink-0 place-items-center rounded-md bg-subtle text-ink-3 hover:text-accent" onClick={() => setOpen(e)} aria-label={`Open ${e.file_name}`}>
              {e.mime.startsWith('image/') ? <ImageIcon className="size-6" /> : <FileText className="size-6" />}
            </button>
            <div className="min-w-0 flex-1 text-[13px]">
              <button className="block max-w-full truncate text-left font-semibold text-accent hover:underline" onClick={() => setOpen(e)}>
                {e.file_name}
              </button>
              <div className="text-ink-3">
                {e.uploaded_by_name ?? 'Officer'} · {fmtDateTime(e.uploaded_at)}
              </div>
              {e.note && <p className="mt-1 text-ink-2">{e.note}</p>}
              {e.review_status !== 'pending' && (
                <p className="mt-1 text-ink-2">
                  <span className="font-semibold">{e.reviewed_by_name}</span>: {e.review_remark} <span className="text-ink-3">({fmtDateTime(e.reviewed_at)})</span>
                </p>
              )}
              {e.sha256 && (
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-ink-3" title="SHA-256 fingerprint recorded at upload">
                  <ShieldCheck className="size-3" aria-hidden /> {e.sha256.slice(0, 16)}…
                </p>
              )}
            </div>
            <Badge tone={REVIEW_TONE[e.review_status]}>{REVIEW_LABEL[e.review_status]}</Badge>
          </li>
        ))}
      </ul>
      {open && <EvidenceViewer meta={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** data: URL -> blob: URL, so PDFs can be embedded under a strict Content-Security-Policy. */
function useBlobUrl(dataUrl: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!dataUrl) return;
    const comma = dataUrl.indexOf(',');
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [dataUrl]);
  return url;
}

function EvidenceViewer({ meta, onClose }: { meta: EvidenceMeta; onClose: () => void }) {
  const q = useQ('evidence.get', { id: meta.id });
  const isPdf = !!q.data && !q.data.mime.startsWith('image/');
  const pdfUrl = useBlobUrl(isPdf ? q.data?.data_url : undefined);
  return (
    <Modal open onClose={onClose} title={meta.file_name} wide>
      {q.isLoading && <Skeleton className="h-72 w-full" />}
      {q.error && <p className="text-bad">{q.error.message}</p>}
      {q.data &&
        (!isPdf ? (
          <img src={q.data.data_url} alt={meta.note ?? meta.file_name} className={cx('mx-auto max-h-[70vh] w-auto rounded-md border border-line')} />
        ) : pdfUrl ? (
          <object data={pdfUrl} type="application/pdf" className="h-[70vh] w-full" aria-label={meta.file_name}>
            <a href={pdfUrl} download={meta.file_name} className="text-accent underline">
              Download PDF
            </a>
          </object>
        ) : (
          <Skeleton className="h-72 w-full" />
        ))}
    </Modal>
  );
}
