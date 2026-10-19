DO $$ BEGIN
  CREATE TYPE node_status AS ENUM ('draft', 'generating', 'generated', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_type AS ENUM ('image', 'text');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL,
  root_node_id TEXT,
  settings     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT        PRIMARY KEY,
  project_id  TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT        REFERENCES nodes(id) ON DELETE SET NULL,
  depth       INTEGER     NOT NULL DEFAULT 0,
  title       TEXT        NOT NULL DEFAULT '',
  description TEXT        NOT NULL DEFAULT '',
  source_type source_type NOT NULL DEFAULT 'image',
  image_url   TEXT,
  status      node_status NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nodes_project_id_idx ON nodes(project_id);
CREATE INDEX IF NOT EXISTS nodes_parent_id_idx  ON nodes(parent_id);

-- Additive migration: legacy image pages keep a NULL scene document.
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS scene_document JSONB;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS content_metadata JSONB;

CREATE TABLE IF NOT EXISTS hotspots (
  id             TEXT    PRIMARY KEY,
  node_id        TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label          TEXT    NOT NULL DEFAULT '',
  pos_x          FLOAT   NOT NULL,
  pos_y          FLOAT   NOT NULL,
  width          FLOAT   NOT NULL,
  height         FLOAT   NOT NULL,
  selected       BOOLEAN NOT NULL DEFAULT false,
  target_node_id TEXT    REFERENCES nodes(id) ON DELETE SET NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  score          FLOAT
);

-- Section connections describe knowledge-page branches, never fabricated image boxes.
ALTER TABLE hotspots ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'image';
ALTER TABLE hotspots ALTER COLUMN pos_x DROP NOT NULL;
ALTER TABLE hotspots ALTER COLUMN pos_y DROP NOT NULL;
ALTER TABLE hotspots ALTER COLUMN width DROP NOT NULL;
ALTER TABLE hotspots ALTER COLUMN height DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE hotspots ADD CONSTRAINT hotspots_kind_geometry_check CHECK (
    (kind = 'section' AND pos_x IS NULL AND pos_y IS NULL AND width IS NULL AND height IS NULL AND score IS NULL)
    OR (kind = 'image' AND pos_x IS NOT NULL AND pos_y IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS hotspots_node_id_idx ON hotspots(node_id);

-- Durable children generation. Only public provider metadata and content live here.
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'queued',
  message TEXT NOT NULL DEFAULT '',
  pct INTEGER NOT NULL DEFAULT 0,
  input JSONB NOT NULL,
  provider_config JSONB NOT NULL,
  previous_status TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{"nodes":[],"warnings":[],"failed_hotspot_ids":[]}',
  error JSONB,
  required_credentials JSONB NOT NULL DEFAULT '[]',
  confirmation JSONB,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  last_event_id BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, operation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_active_node_idx ON generation_jobs(node_id)
  WHERE status IN ('queued','running','waiting_credentials','waiting_confirmation','cancelling');
CREATE INDEX IF NOT EXISTS generation_jobs_project_idx ON generation_jobs(project_id, created_at DESC);
-- Additive, replay-compatible page jobs. A root has no node until commit.
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'children';
ALTER TABLE generation_jobs ALTER COLUMN node_id DROP NOT NULL;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS target_node_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS input_summary JSONB NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS generation_attempts (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  hotspot_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  result JSONB,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(job_id, hotspot_id, stage, attempt_no)
);
CREATE TABLE IF NOT EXISTS generation_decisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  hotspot_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS generation_events (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, event_key)
);
CREATE INDEX IF NOT EXISTS generation_events_job_idx ON generation_events(job_id, id);

-- Content history is independent of durable job execution and contains only
-- allowlisted page content. Images have immutable asset URLs.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS node_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  project_revision BIGINT NOT NULL,
  reason TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_id, sequence)
);
CREATE INDEX IF NOT EXISTS node_versions_node_idx ON node_versions(node_id, sequence DESC);
CREATE TABLE IF NOT EXISTS version_restore_operations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES node_versions(id) ON DELETE CASCADE,
  expected_revision BIGINT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id, operation_id)
);
