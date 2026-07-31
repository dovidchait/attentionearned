'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FormState {
  childName: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
}

export default function EnrollPage() {
  const [form, setForm] = useState<FormState>({
    childName: '',
    parentName: '',
    parentEmail: '',
    parentPhone: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'enrolling' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [enrolledName, setEnrolledName] = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted[0]) return;
    setFile(accepted[0]);
    setPreview(URL.createObjectURL(accepted[0]));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
  });

  function setField(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please select a photo.'); return; }
    setStatus('uploading');
    setError('');

    const presignRes = await fetch('/api/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, folder: 'enrollment' }),
    });
    const { key, uploadUrl } = await presignRes.json();

    const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!uploadRes.ok) { setStatus('error'); setError('Photo upload failed.'); return; }

    setStatus('enrolling');
    const enrollRes = await fetch('/api/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        childName: form.childName,
        s3Key: key,
        parentName: form.parentName,
        parentEmail: form.parentEmail,
        parentPhone: form.parentPhone || undefined,
      }),
    });

    if (!enrollRes.ok) {
      const { error: msg } = await enrollRes.json();
      setStatus('error');
      setError(msg ?? 'Enrollment failed.');
      return;
    }

    setEnrolledName(form.childName);
    setStatus('done');
    setForm({ childName: '', parentName: '', parentEmail: '', parentPhone: '' });
    setFile(null);
    setPreview(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Enroll a Child</h1>
        <p>Upload one clear photo of the child. The system will learn their face and auto-tag future uploads.</p>
      </div>

      {status === 'done' && (
        <div className="alert alert-success">
          {enrolledName} has been enrolled! Future photos will be auto-tagged and sent to their parents.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <form onSubmit={handleSubmit} className="card stack">
        <div className="grid-2">
          <div>
            <label>Child&apos;s Full Name</label>
            <input required value={form.childName} onChange={setField('childName')} placeholder="Emma Johnson" />
          </div>
          <div>
            <label>Parent&apos;s Full Name</label>
            <input required value={form.parentName} onChange={setField('parentName')} placeholder="Sarah Johnson" />
          </div>
          <div>
            <label>Parent&apos;s Email</label>
            <input required type="email" value={form.parentEmail} onChange={setField('parentEmail')} placeholder="sarah@example.com" />
          </div>
          <div>
            <label>Parent&apos;s Phone (optional)</label>
            <input type="tel" value={form.parentPhone} onChange={setField('parentPhone')} placeholder="+1 555 000 0000" />
          </div>
        </div>

        <div>
          <label>Enrollment Photo</label>
          <div
            {...getRootProps()}
            style={{
              border: '2px dashed var(--border)',
              borderRadius: 'var(--radius)',
              padding: '32px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragActive ? '#eff6ff' : undefined,
              transition: 'background .15s',
            }}
          >
            <input {...getInputProps()} />
            {preview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={preview} alt="preview" style={{ maxHeight: 200, borderRadius: 6 }} />
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                {isDragActive ? 'Drop the photo here' : 'Drag & drop a clear face photo, or click to browse'}
              </p>
            )}
          </div>
          {file && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{file.name}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={status === 'uploading' || status === 'enrolling'}
          >
            {status === 'uploading' ? 'Uploading...' : status === 'enrolling' ? 'Enrolling...' : 'Enroll Child'}
          </button>
        </div>
      </form>
    </div>
  );
}
