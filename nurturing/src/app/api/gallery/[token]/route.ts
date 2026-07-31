import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getPresignedDownloadUrl } from '@/lib/s3';

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const db = createServerClient();

  const { data: parent } = await db
    .from('parents')
    .select('id, name, child_id, children ( name )')
    .eq('id', params.token)
    .single();

  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const child = parent.children as unknown as { name: string } | null;

  const { data: tags } = await db
    .from('photo_tags')
    .select('photos ( id, s3_key, uploaded_at )')
    .eq('child_id', parent.child_id)
    .order('created_at', { ascending: false });

  const photos = await Promise.all(
    (tags ?? []).map(async (tag) => {
      const photo = tag.photos as unknown as { id: string; s3_key: string; uploaded_at: string };
      return { ...photo, url: await getPresignedDownloadUrl(photo.s3_key, 3600) };
    })
  );

  return NextResponse.json({
    parentName: parent.name,
    childName: child?.name ?? 'Your child',
    photos,
  });
}
