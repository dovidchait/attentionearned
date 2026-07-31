import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { searchFaces } from '@/lib/rekognition';

interface PhotoResult {
  photoId: string;
  s3Key: string;
  matches: { childId: string; childName: string; confidence: number }[];
  untagged: boolean;
}

export async function POST(req: NextRequest) {
  const { s3Keys } = await req.json();

  if (!Array.isArray(s3Keys) || s3Keys.length === 0) {
    return NextResponse.json({ error: 's3Keys array required' }, { status: 400 });
  }

  const db = createServerClient();

  const { data: allChildren } = await db
    .from('children')
    .select('id, name, rekognition_face_id')
    .not('rekognition_face_id', 'is', null);

  const faceIdToChild = new Map(
    (allChildren ?? []).map((c) => [c.rekognition_face_id!, { id: c.id, name: c.name }])
  );

  const results: PhotoResult[] = [];

  for (const s3Key of s3Keys) {
    const { data: photo, error: photoErr } = await db
      .from('photos')
      .insert({ s3_key: s3Key, original_filename: s3Key.split('/').pop() })
      .select()
      .single();

    if (photoErr) continue;

    const matches = await searchFaces(s3Key);
    const taggedChildren: PhotoResult['matches'] = [];

    for (const match of matches) {
      const faceId = match.Face?.FaceId;
      const confidence = match.Similarity ?? 0;
      if (!faceId) continue;

      const child = faceIdToChild.get(faceId);
      if (!child) continue;

      await db.from('photo_tags').insert({
        photo_id: photo.id,
        child_id: child.id,
        confidence,
        face_bounding_box: match.Face?.BoundingBox as Record<string, number> | null,
      });

      taggedChildren.push({ childId: child.id, childName: child.name, confidence });
    }

    await db.from('photos').update({ processed: true }).eq('id', photo.id);

    results.push({
      photoId: photo.id,
      s3Key,
      matches: taggedChildren,
      untagged: taggedChildren.length === 0,
    });
  }

  return NextResponse.json({ results });
}
