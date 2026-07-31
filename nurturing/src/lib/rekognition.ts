import {
  RekognitionClient,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  CreateCollectionCommand,
  DeleteFacesCommand,
  type FaceMatch,
} from '@aws-sdk/client-rekognition';

const client = new RekognitionClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const COLLECTION_ID = process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'nurturing-faces';
const MATCH_THRESHOLD = 85;

export async function ensureCollection() {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: COLLECTION_ID }));
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'ResourceAlreadyExistsException') throw err;
  }
}

export async function enrollFace(s3Key: string): Promise<string> {
  const res = await client.send(
    new IndexFacesCommand({
      CollectionId: COLLECTION_ID,
      Image: { S3Object: { Bucket: process.env.AWS_S3_BUCKET, Name: s3Key } },
      MaxFaces: 1,
      QualityFilter: 'AUTO',
      DetectionAttributes: [],
    })
  );

  const faceId = res.FaceRecords?.[0]?.Face?.FaceId;
  if (!faceId) throw new Error('No face detected in enrollment image');
  return faceId;
}

export async function searchFaces(s3Key: string): Promise<FaceMatch[]> {
  try {
    const res = await client.send(
      new SearchFacesByImageCommand({
        CollectionId: COLLECTION_ID,
        Image: { S3Object: { Bucket: process.env.AWS_S3_BUCKET, Name: s3Key } },
        MaxFaces: 10,
        FaceMatchThreshold: MATCH_THRESHOLD,
      })
    );
    return res.FaceMatches ?? [];
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'InvalidParameterException') {
      return [];
    }
    throw err;
  }
}

export async function deleteFace(faceId: string) {
  await client.send(
    new DeleteFacesCommand({ CollectionId: COLLECTION_ID, FaceIds: [faceId] })
  );
}
