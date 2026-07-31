# Nurturing — Facial Recognition Photo System

## What it does

Staff upload photos of children. AWS Rekognition identifies each child automatically using face matching. The system emails parents their child's photos.

## One-time Setup

### 1. Supabase

1. Create a project at https://supabase.com
2. Run `supabase/migrations/001_initial.sql` in the SQL editor
3. Copy the project URL and keys to `.env.local`

### 2. AWS

1. Create an S3 bucket (private, no public access)
2. Create an IAM user with this policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject","s3:GetObject"], "Resource": "arn:aws:s3:::YOUR-BUCKET/*" },
       { "Effect": "Allow", "Action": ["rekognition:IndexFaces","rekognition:SearchFacesByImage","rekognition:CreateCollection","rekognition:DeleteFaces"], "Resource": "*" }
     ]
   }
   ```
3. Copy the access key and secret to `.env.local`
4. The Rekognition collection is created automatically on first enrollment

### 3. Resend

1. Sign up at https://resend.com and verify your domain
2. Copy the API key to `.env.local`

### 4. Environment

```bash
cp .env.example .env.local
# fill in all values
```

### 5. Run

```bash
npm install
npm run dev   # starts on http://localhost:3001
```

## Workflow

### Enrolling a child (first time)
1. Go to `/enroll`
2. Enter the child's name and parent's email
3. Upload one clear face photo
4. Submit — the system indexes the face in Rekognition

### Uploading photos
1. Go to `/upload`
2. Drag in any number of photos
3. Click **Process** — each photo is scanned and tagged automatically
4. Photos with no match appear on the Dashboard for manual assignment
5. Click **Send to Parents** to email all newly tagged photos

### Parent gallery
Parents receive an email with their child's photos embedded. Each email includes a link to `/gallery/{parent-id}` where they can view all photos ever taken of their child.

## Cron (automated notifications)

To send notifications automatically (e.g. end of day), call:

```
POST /api/notify
Header: x-cron-secret: <NOTIFY_CRON_SECRET>
```

Set up a Vercel Cron Job or an external scheduler (e.g. GitHub Actions) to hit this endpoint daily.
