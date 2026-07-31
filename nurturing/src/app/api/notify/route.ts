import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendPhotoEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.NOTIFY_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServerClient();

  const { data: unnotified } = await db
    .from('photo_tags')
    .select(
      `
      id,
      photo_id,
      child_id,
      photos ( s3_key ),
      children ( name, parents ( name, email ) )
    `
    )
    .is('notified_at', null);

  if (!unnotified || unnotified.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  type GroupKey = string;
  const groups = new Map<
    GroupKey,
    {
      parentName: string;
      parentEmail: string;
      childName: string;
      photoKeys: string[];
      tagIds: string[];
    }
  >();

  for (const tag of unnotified) {
    const child = tag.children as unknown as {
      name: string;
      parents: { name: string; email: string }[];
    } | null;
    const photo = tag.photos as unknown as { s3_key: string } | null;
    if (!child || !photo) continue;

    for (const parent of child.parents ?? []) {
      const key: GroupKey = `${child.name}||${parent.email}`;
      if (!groups.has(key)) {
        groups.set(key, {
          parentName: parent.name,
          parentEmail: parent.email,
          childName: child.name,
          photoKeys: [],
          tagIds: [],
        });
      }
      const g = groups.get(key)!;
      g.photoKeys.push(photo.s3_key);
      g.tagIds.push(tag.id);
    }
  }

  let sent = 0;
  for (const group of groups.values()) {
    try {
      await sendPhotoEmail(group);
      await db
        .from('photo_tags')
        .update({ notified_at: new Date().toISOString() })
        .in('id', group.tagIds);
      sent++;
    } catch {
      // continue other groups even if one fails
    }
  }

  return NextResponse.json({ sent });
}
