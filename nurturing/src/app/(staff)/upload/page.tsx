'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileStatus {
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  matches?: { childName: string; confidence: number }[];
  untagged?: boolean;
  error?: string;
}

export default function UploadPage() {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [running, setRunning] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyResult, setNotifyResult] = useState<number | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...accepted.map((f) => ({ file: f, status: 'pending' as const })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  });

  function updateFile(idx: number, patch: Partial<FileStatus>) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  async function processFile(file: File, idx: number): Promise<string | null> {
    updateFile(idx, { status: 'uploading' });

    const presignRes = await fetch('/api/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, folder: 'photos' }),
    });
    if (!presignRes.ok) { updateFile(idx, { status: 'error', error: 'Presign failed' }); return null; }
    const { key, uploadUrl } = await presignRes.json();

    const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!uploadRes.ok) { updateFile(idx, { status: 'error', error: 'Upload failed' }); return null; }

    updateFile(idx, { status: 'processing' });
    return key;
  }

  async function handleProcess() {
    setRunning(true);
    setNotifyResult(null);

    const pending = files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.status === 'pending');

    const s3Keys: { key: string; idx: number }[] = [];
    for (const { f, i } of pending) {
      const key = await processFile(f.file, i);
      if (key) s3Keys.push({ key, idx: i });
    }

    if (s3Keys.length > 0) {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Keys: s3Keys.map((x) => x.key) }),
      });
      const { results } = await res.json();

      for (let i = 0; i < s3Keys.length; i++) {
        const result = results[i];
        const idx = s3Keys[i].idx;
        updateFile(idx, {
          status: 'done',
          matches: result?.matches ?? [],
          untagged: result?.untagged ?? true,
        });
      }
    }

    setRunning(false);
  }

  async function handleNotify() {
    setNotifying(true);
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'x-cron-secret': '' },
    });
    const { sent } = await res.json();
    setNotifyResult(sent);
    setNotifying(false);
  }

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const doneCount = files.filter((f) => f.status === 'done').length;

  return (
    <div className="page">
      <div className="page-header">
        <div className="row">
          <div>
            <h1>Upload Photos</h1>
            <p>Drop as many photos as you like. The system will auto-identify each child.</p>
          </div>
          <div className="spacer" />
          {doneCount > 0 && (
            <button
              className="btn btn-secondary"
              onClick={handleNotify}
              disabled={notifying}
            >
              {notifying ? 'Sending...' : 'Send to Parents'}
            </button>
          )}
          {pendingCount > 0 && (
            <button className="btn btn-primary" onClick={handleProcess} disabled={running}>
              {running ? 'Processing...' : `Process ${pendingCount} photo${pendingCount > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>

      {notifyResult !== null && (
        <div className="alert alert-success">
          Sent emails to {notifyResult} parent group{notifyResult !== 1 ? 's' : ''}.
        </div>
      )}

      <div
        {...getRootProps()}
        style={{
          border: '2px dashed var(--border)',
          borderRadius: 'var(--radius)',
          padding: '40px',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragActive ? '#eff6ff' : 'var(--surface)',
          marginBottom: 20,
        }}
      >
        <input {...getInputProps()} />
        <p style={{ color: 'var(--muted)', fontSize: 15 }}>
          {isDragActive ? 'Drop photos here' : 'Drag & drop photos here, or click to browse'}
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Supports JPEG, PNG, HEIC — upload hundreds at once
        </p>
      </div>

      {files.length > 0 && (
        <div className="stack">
          {files.map((item, i) => (
            <div key={i} className="card row" style={{ gap: 12 }}>
              <div style={{ width: 48, height: 48, flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(item.file)}
                  alt={item.file.name}
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.file.name}
                </p>
                {item.status === 'done' && item.matches && item.matches.length > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--success)' }}>
                    Matched: {item.matches.map((m) => `${m.childName} (${Math.round(m.confidence)}%)`).join(', ')}
                  </p>
                )}
                {item.status === 'done' && item.untagged && (
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>No match — needs manual tag</p>
                )}
                {item.error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{item.error}</p>}
              </div>
              <span
                className={`badge ${
                  item.status === 'done' && !item.untagged
                    ? 'badge-green'
                    : item.status === 'done'
                    ? 'badge-yellow'
                    : item.status === 'error'
                    ? 'badge-yellow'
                    : 'badge-blue'
                }`}
              >
                {item.status === 'pending' ? 'Ready'
                  : item.status === 'uploading' ? 'Uploading'
                  : item.status === 'processing' ? 'Scanning'
                  : item.status === 'done' && !item.untagged ? 'Tagged'
                  : item.status === 'done' ? 'Untagged'
                  : 'Error'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
