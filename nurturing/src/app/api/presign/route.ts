import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { getPresignedUploadUrl } from '@/lib/s3';

export async function POST(req: NextRequest) {
  const { filename, contentType, folder } = await req.json();

  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType required' }, { status: 400 });
  }

  const ext = filename.split('.').pop() ?? 'jpg';
  const key = `${folder ?? 'photos'}/${uuid()}.${ext}`;
  const uploadUrl = await getPresignedUploadUrl(key, contentType);

  return NextResponse.json({ key, uploadUrl });
}
