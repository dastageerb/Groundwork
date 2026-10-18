ALTER TABLE company_sign_in ADD COLUMN enabled boolean NOT NULL DEFAULT false;
-- Existing saved settings must be explicitly connected by an administrator.
-- A successful connection binds their company identity before enabling company-only login.
