ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN auth_version integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE TABLE index_generations (
 id uuid PRIMARY KEY, model text NOT NULL, model_digest text NOT NULL,
 pinned_model text NOT NULL, dimensions integer,
 pipeline text NOT NULL DEFAULT 'markdown-v2',
 status text NOT NULL CHECK(status IN ('staging','complete','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chunks ADD COLUMN generation_id uuid REFERENCES index_generations(id) ON DELETE CASCADE;
ALTER TABLE chunks ADD COLUMN document_revision integer NOT NULL DEFAULT 0;
CREATE INDEX chunks_generation ON chunks(generation_id,document_id);
ALTER TABLE index_meta ADD COLUMN generation_id uuid REFERENCES index_generations(id);
ALTER TABLE index_meta ADD COLUMN model_digest text;
ALTER TABLE index_meta ADD COLUMN pinned_model text;
ALTER TABLE index_jobs ADD COLUMN heartbeat_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE audit_log ADD COLUMN answer_text text;
ALTER TABLE audit_log ADD COLUMN finished_at timestamptz;
CREATE TABLE auth_attempts (
 key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
