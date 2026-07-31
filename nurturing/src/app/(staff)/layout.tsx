import Link from 'next/link';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-brand">Nurturing</span>
          <Link href="/dashboard" className="nav-link">Dashboard</Link>
          <Link href="/upload" className="nav-link">Upload Photos</Link>
          <Link href="/enroll" className="nav-link">Enroll Child</Link>
          <Link href="/children" className="nav-link">Children</Link>
        </div>
      </nav>
      {children}
    </>
  );
}
