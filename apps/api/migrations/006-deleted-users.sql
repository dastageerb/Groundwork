ALTER TABLE users ADD COLUMN deleted_at timestamptz;
-- Keep identity tombstones so a removed company user cannot rejoin through JIT provisioning.
