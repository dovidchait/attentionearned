import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getPresignedDownloadUrl } from '@/lib/s3';

export async function GET(req: NextRequest) {
  const childId = req.nextUrl.searchParams.get('childId');
  const untaggedOnly = req.nextUrl.searchParams.get('untagged') === 'true';

  const db = createServerClient();

  if (untaggedOnly) {
    const { data: taggedPhotoIds } = await db.from('photo_tags').select('photo_id');
    const tagged = (taggedPhotoIds ?? []).map((r) => r.photo_id);

    const query = db
      .from('photos')
      .select('id, s3_key, original_filename, uploaded_at')
      .eq('processed', true)
      .order('uploaded_at', { ascending: false });

    const { data, error } = tagged.length
      ? await query.not('id', 'in', `(${tagged.join(',')})`)
      : await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const withUrls = await Promise.all(
      (data ?? []).map(async (p) => ({
        ...p,
        url: await getPresignedDownloadUrl(p.s3_key),
      }))
    );
    return NextResponse.json(withUrls);
  }

  if (childId) {
    const { data, error } = await db
      .from('photo_tags')
      .select('photos ( id, s3_key, original_filename, uploaded_at ), confidence')
      .eq('child_id', childId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const withUrls = await Promise.all(
      (data ?? []).map(async (row) => {
        const photo = row.photos as unknown as {
          id: string;
          s3_key: string;
          original_filename: string | null;
          uploaded_at: string;
        };
        return {
          ...photo,
          confidence: row.confidence,
          url: await getPresignedDownloadUrl(photo.s3_key),
        };
      })
    );
    return NextResponse.json(withUrls);
  }

  return NextResponse.json({ error: 'childId or untagged=true required' }, { status: 400 });
}
