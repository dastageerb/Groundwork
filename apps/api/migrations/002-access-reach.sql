ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS departments (id uuid PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS user_departments (user_id uuid REFERENCES users(id) ON DELETE CASCADE, department_id uuid REFERENCES departments(id) ON DELETE CASCADE, PRIMARY KEY(user_id,department_id));
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_visibility_check;
ALTER TABLE documents ADD CONSTRAINT documents_visibility_check CHECK (visibility IN ('everyone','departments','admins'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'folder' CHECK (source_kind IN ('folder','managed'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS needs_index boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE TABLE IF NOT EXISTS document_departments (document_id uuid REFERENCES documents(id) ON DELETE CASCADE, department_id uuid REFERENCES departments(id) ON DELETE CASCADE, PRIMARY KEY(document_id,department_id));
CREATE TABLE IF NOT EXISTS oidc_identities (issuer text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id));
CREATE TABLE IF NOT EXISTS oidc_states (id_hash text PRIMARY KEY, state text NOT NULL, nonce text NOT NULL, verifier text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 question text NOT NULL, sources jsonb NOT NULL DEFAULT '[]',
 outcome text NOT NULL CHECK (outcome IN ('pending','answered','declined','failed','cancelled')),
 model_called boolean NOT NULL DEFAULT false, duration_ms integer,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_at ON audit_log(created_at DESC);
CREATE TABLE IF NOT EXISTS feedback (
 audit_id uuid REFERENCES audit_log(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 helpful boolean NOT NULL, comment text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(audit_id,user_id)
);
