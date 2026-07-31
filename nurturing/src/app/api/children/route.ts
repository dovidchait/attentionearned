import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  const db = createServerClient();
  const { data, error } = await db
    .from('children')
    .select('id, name, enrollment_s3_key, created_at, parents ( id, name, email )')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
