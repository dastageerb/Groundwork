CREATE TABLE company_sign_in (
  id integer PRIMARY KEY CHECK (id = 1),
  revision uuid NOT NULL,
  settings jsonb,
  secret_encrypted text,
  last_login_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company_sign_in(id,revision) VALUES(1,gen_random_uuid());
ALTER TABLE oidc_states ADD COLUMN config_revision text;
ALTER TABLE oidc_states ADD COLUMN verification_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE oidc_states ADD COLUMN verification_auth_version integer;
