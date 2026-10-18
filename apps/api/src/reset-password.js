import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { database, transaction } from './db.js';
const username = process.argv[2];
if (!username) throw new Error('Usage: npm run reset-password -w apps/api -- username');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before resetting a password.');
const pool = database(process.env.DATABASE_URL); const temporaryPassword = randomBytes(18).toString('base64url');
try {
  const hash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
  await transaction(pool, async db => {
    const result = await db.query('UPDATE users SET password_hash=$2,must_change_password=true,auth_version=auth_version+1 WHERE username=$1 AND deleted_at IS NULL AND password_hash IS NOT NULL RETURNING id', [username.toLowerCase(), hash]);
    if (!result.rowCount) throw new Error('Local account not found. Company accounts use their identity provider.');
    await db.query('DELETE FROM sessions WHERE user_id=$1', [result.rows[0].id]);
  });
  console.log(`Temporary password (shown once): ${temporaryPassword}`);
} finally { await pool.end(); }
