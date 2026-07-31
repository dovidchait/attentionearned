import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { enrollFace } from '@/lib/rekognition';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { childId } = await req.json();
  if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 });

  const db = createServerClient();

  const { data: photo, error: photoErr } = await db
    .from('photos')
    .select('s3_key')
    .eq('id', params.id)
    .single();

  if (photoErr || !photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });

  const { data: child, error: childErr } = await db
    .from('children')
    .select('id, rekognition_face_id')
    .eq('id', childId)
    .single();

  if (childErr || !child) return NextResponse.json({ error: 'Child not found' }, { status: 404 });

  if (!child.rekognition_face_id) {
    try {
      const faceId = await enrollFace(photo.s3_key);
      await db
        .from('children')
        .update({ rekognition_face_id: faceId })
        .eq('id', childId);
    } catch {
      // face not clear enough to enroll — still tag without re-indexing
    }
  }

  const { error: tagErr } = await db.from('photo_tags').insert({
    photo_id: params.id,
    child_id: childId,
    confidence: 100,
    face_bounding_box: null,
  });

  if (tagErr) return NextResponse.json({ error: tagErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
