'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Child {
  id: string;
  name: string;
  enrollment_s3_key: string | null;
  created_at: string;
  parents: { id: string; name: string; email: string }[];
}

export default function ChildrenPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/children')
      .then((r) => r.json())
      .then((data) => { setChildren(Array.isArray(data) ? data : []); setLoading(false); });
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div className="row">
          <div>
            <h1>Children</h1>
            <p>{children.length} enrolled</p>
          </div>
          <div className="spacer" />
          <Link href="/enroll" className="btn btn-primary">Enroll Child</Link>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

      {!loading && children.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--muted)' }}>No children enrolled yet.</p>
          <Link href="/enroll" className="btn btn-primary" style={{ marginTop: 16 }}>
            Enroll first child
          </Link>
        </div>
      )}

      <div className="stack">
        {children.map((child) => (
          <div key={child.id} className="card">
            <div className="row">
              <div>
                <p style={{ fontWeight: 600 }}>{child.name}</p>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                  Enrolled {new Date(child.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="spacer" />
              <div style={{ textAlign: 'right' }}>
                {child.parents.map((p) => (
                  <p key={p.id} style={{ fontSize: 13 }}>
                    {p.name} &middot; <span style={{ color: 'var(--muted)' }}>{p.email}</span>
                  </p>
                ))}
              </div>
              <Link href={`/children/${child.id}`} className="btn btn-secondary" style={{ marginLeft: 8 }}>
                View Photos
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
