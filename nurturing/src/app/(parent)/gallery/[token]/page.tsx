'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface GalleryData {
  parentName: string;
  childName: string;
  photos: { id: string; s3_key: string; uploaded_at: string; url: string }[];
}

export default function ParentGalleryPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<GalleryData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/gallery/${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((e: { error: string }) => { throw new Error(e.error); }))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 18, color: '#6b6b63' }}>This gallery link is not valid.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6b6b63' }}>Loading your gallery...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Hi {data.parentName}!</h1>
        <p style={{ color: '#6b6b63', marginTop: 4 }}>
          Here are all the photos of {data.childName} ({data.photos.length} total)
        </p>
      </div>

      {data.photos.length === 0 && (
        <p style={{ color: '#6b6b63', textAlign: 'center', padding: 40 }}>
          No photos yet — check back soon!
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {data.photos.map((photo) => (
          <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={`Photo of ${data.childName}`}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, border: '1px solid #e4e4e0' }}
            />
          </a>
        ))}
      </div>

      <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 40 }}>
        Photo links expire after 1 hour. Reload the page to refresh them.
      </p>
    </div>
  );
}
