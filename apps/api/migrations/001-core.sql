CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, name text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','member')), password_hash text NOT NULL,
 must_change_password boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS documents (
 id uuid PRIMARY KEY, title text NOT NULL, source_path text UNIQUE NOT NULL,
 category text NOT NULL DEFAULT 'General', version text NOT NULL DEFAULT '1',
 visibility text NOT NULL DEFAULT 'everyone' CHECK (visibility = 'everyone'),
 content_hash text NOT NULL, indexed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chunks (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 breadcrumb text NOT NULL, content text NOT NULL, embedding vector NOT NULL,
 ordinal integer NOT NULL
);
CREATE TABLE IF NOT EXISTS index_meta (
 id integer PRIMARY KEY CHECK (id = 1), model text NOT NULL, dimensions integer NOT NULL,
 built_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS index_jobs (
 id uuid PRIMARY KEY, status text NOT NULL, completed integer NOT NULL DEFAULT 0,
 total integer NOT NULL DEFAULT 0, message text NOT NULL DEFAULT '',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
