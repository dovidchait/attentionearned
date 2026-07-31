'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface UntaggedPhoto {
  id: string;
  s3_key: string;
  original_filename: string | null;
  uploaded_at: string;
  url: string;
}

interface Child {
  id: string;
  name: string;
  parents: { id: string; name: string; email: string }[];
}

export default function DashboardPage() {
  const [untagged, setUntagged] = useState<UntaggedPhoto[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [tagging, setTagging] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/photos?untagged=true').then((r) => r.json()),
      fetch('/api/children').then((r) => r.json()),
    ]).then(([u, c]) => {
      setUntagged(Array.isArray(u) ? u : []);
      setChildren(Array.isArray(c) ? c : []);
      setLoading(false);
    });
  }, []);

  async function assignTag(photoId: string) {
    const childId = selectedChild[photoId];
    if (!childId) return;
    setTagging(photoId);
    await fetch(`/api/photos/${photoId}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId }),
    });
    setUntagged((prev) => prev.filter((p) => p.id !== photoId));
    setTagging(null);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="row">
          <div>
            <h1>Dashboard</h1>
            <p>Untagged photos needing manual assignment</p>
          </div>
          <div className="spacer" />
          <Link href="/upload" className="btn btn-primary">Upload Photos</Link>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

      {!loading && untagged.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--muted)' }}>All photos have been tagged.</p>
          <Link href="/upload" className="btn btn-primary" style={{ marginTop: 16 }}>
            Upload more photos
          </Link>
        </div>
      )}

      {!loading && untagged.length > 0 && (
        <div className="stack">
          {untagged.map((photo) => (
            <div key={photo.id} className="card row" style={{ gap: 16 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.original_filename ?? 'photo'}
                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
              />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                  {photo.original_filename ?? photo.s3_key}
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <select
                    value={selectedChild[photo.id] ?? ''}
                    onChange={(e) =>
                      setSelectedChild((p) => ({ ...p, [photo.id]: e.target.value }))
                    }
                    style={{ flex: 1 }}
                  >
                    <option value="">Select child...</option>
                    {children.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={!selectedChild[photo.id] || tagging === photo.id}
                    onClick={() => assignTag(photo.id)}
                  >
                    {tagging === photo.id ? 'Saving...' : 'Assign'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
