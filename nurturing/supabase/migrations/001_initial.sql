create extension if not exists "uuid-ossp";

create table children (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  rekognition_face_id text unique,
  enrollment_s3_key text,
  created_at timestamptz not null default now()
);

create table parents (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid not null references children(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default uuid_generate_v4(),
  s3_key text not null unique,
  original_filename text,
  uploaded_at timestamptz not null default now(),
  processed boolean not null default false
);

create table photo_tags (
  id uuid primary key default uuid_generate_v4(),
  photo_id uuid not null references photos(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  confidence float not null,
  face_bounding_box jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(photo_id, child_id)
);

create index on photo_tags(child_id);
create index on photo_tags(notified_at) where notified_at is null;
create index on photos(processed);
