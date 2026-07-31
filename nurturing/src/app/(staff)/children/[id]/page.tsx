'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Photo {
  id: string;
  s3_key: string;
  original_filename: string | null;
  uploaded_at: string;
  confidence: number;
  url: string;
}

export default function ChildPhotoPage() {
  const { id } = useParams<{ id: string }>();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/photos?childId=${id}`)
      .then((r) => r.json())
      .then((data) => { setPhotos(Array.isArray(data) ? data : []); setLoading(false); });
  }, [id]);

  return (
    <div className="page">
      <div className="page-header">
        <div className="row">
          <div>
            <h1>Child Photos</h1>
            <p>{photos.length} photos</p>
          </div>
          <div className="spacer" />
          <Link href="/children" className="btn btn-secondary">Back to Children</Link>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

      {!loading && photos.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--muted)' }}>No photos yet. Upload some photos and the system will auto-tag this child.</p>
        </div>
      )}

      <div className="photo-grid">
        {photos.map((photo) => (
          <div key={photo.id} style={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.original_filename ?? 'photo'}
              className="photo-thumb"
            />
            <div style={{
              position: 'absolute', bottom: 4, right: 4,
              background: 'rgba(0,0,0,.55)', color: '#fff',
              fontSize: 10, padding: '2px 5px', borderRadius: 4,
            }}>
              {Math.round(photo.confidence)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
