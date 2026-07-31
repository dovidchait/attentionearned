import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { enrollFace, ensureCollection } from '@/lib/rekognition';

export async function POST(req: NextRequest) {
  const { childName, s3Key, parentName, parentEmail, parentPhone } = await req.json();

  if (!childName || !s3Key || !parentName || !parentEmail) {
    return NextResponse.json(
      { error: 'childName, s3Key, parentName, parentEmail required' },
      { status: 400 }
    );
  }

  await ensureCollection();

  let faceId: string;
  try {
    faceId = await enrollFace(s3Key);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Face enrollment failed';
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const db = createServerClient();

  const { data: child, error: childErr } = await db
    .from('children')
    .insert({ name: childName, rekognition_face_id: faceId, enrollment_s3_key: s3Key })
    .select()
    .single();

  if (childErr) return NextResponse.json({ error: childErr.message }, { status: 500 });

  const { error: parentErr } = await db.from('parents').insert({
    child_id: child.id,
    name: parentName,
    email: parentEmail,
    phone: parentPhone ?? null,
  });

  if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 });

  return NextResponse.json({ childId: child.id, faceId });
}
