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

CREATE INDEX IF NOT EXISTS hotspots_node_id_idx ON hotspots(node_id);
