import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { HttpError } from './retrieval.js';

const inputSchema = z.object({
  revision: z.uuid(),
  provider: z.enum(['google', 'microsoft']),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(4096).optional(),
  domain: z.string().trim().toLowerCase().max(253).optional(),
  tenantId: z.uuid().optional(),
}).strict();
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function createCompanySignIn(pool, config) {
  const environment = ['oidc', 'both'].includes(config.authMode);
  const callbackUrl = `${config.publicUrl}/api/auth/oidc/callback`;
  // A dedicated derivation prevents using the cookie-signing key directly for encryption.
  const key = createHash('sha256').update('groundwork:company-sign-in:v1\0').update(config.secret).digest();
  const aad = Buffer.from('groundwork:company-sign-in:v1');
  function encrypt(secret) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(value => value.toString('base64url')).join('.');
  }
  function decrypt(value) {
    try {
      const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    } catch { throw new HttpError(503, 'Company sign-in credentials could not be opened. An administrator must save the client secret again in Settings.'); }
  }
  async function row(db = pool, lock = '') {
    return (await db.query(`SELECT * FROM company_sign_in WHERE id=1 ${lock}`)).rows[0];
  }
  function publicSettings(record) {
    if (environment) return { source: 'environment', enabled: true, configured: true, mode: config.authMode, companyLabel: config.oidcLabel, callbackUrl, editable: false };
    return { source: 'workspace', editable: true, enabled: record.enabled, configured: Boolean(record.settings), mode: record.enabled ? 'oidc' : 'local', revision: record.revision,
      ...(record.settings || {}), hasSecret: Boolean(record.secret_encrypted), callbackUrl,
      lastLoginAt: record.last_login_at, updatedAt: record.updated_at };
  }
  async function read() { return publicSettings(await row()); }
  async function assertLocal(db = pool, lock = false) {
    const mode = environment ? config.authMode : (await row(db, lock ? 'FOR SHARE' : '')).enabled ? 'oidc' : 'local';
    if (mode === 'oidc') throw new HttpError(403, 'Use company sign-in for this workspace.');
  }
  async function effective() {
    if (environment) return { ...config, oidcRevision: 'environment:' + createHash('sha256').update(JSON.stringify([
      config.oidcIssuer, config.oidcClientId, config.oidcClientSecret, config.oidcAllowedDomain,
      config.oidcAllowedTenant, config.adminEmails, config.oidcAdminSubjects,
    ])).digest('hex') };
    const record = await row();
    if (!record.settings) return { ...config, authMode: 'local', oidcRevision: record.revision };
    const settings = record.settings;
    return { ...config, authMode: record.enabled ? 'oidc' : 'local', oidcConfigured: true, oidcManaged: true, oidcRevision: record.revision, oidcProvider: settings.provider,
      oidcIssuer: settings.provider === 'google' ? 'https://accounts.google.com' : `https://login.microsoftonline.com/${settings.tenantId}/v2.0`,
      oidcClientId: settings.clientId, oidcClientSecret: decrypt(record.secret_encrypted),
      oidcAllowedDomain: settings.provider === 'google' ? settings.domain : undefined,
      oidcAllowedTenant: settings.provider === 'microsoft' ? settings.tenantId : undefined,
      oidcAllowHttp: false, oidcLabel: settings.provider === 'google' ? 'Google Workspace' : 'Microsoft 365',
      adminEmails: [], oidcAdminSubjects: [] };
  }
  function editable() { if (environment) throw new HttpError(409, 'Company sign-in is managed by server environment variables. Update those settings on the server.'); }
  async function save(body) {
    editable(); const input = inputSchema.parse(body);
    if (input.provider === 'google' && !domainPattern.test(input.domain || '')) throw new HttpError(422, 'Enter your Google Workspace domain, such as example.com.');
    if (input.provider === 'microsoft' && !input.tenantId) throw new HttpError(422, 'Enter your Microsoft Directory (tenant) ID.');
    if (input.provider === 'microsoft' && !z.uuid().safeParse(input.clientId).success) throw new HttpError(422, 'Enter your Microsoft Application (client) ID.');
    return transaction(pool, async db => {
      const current = await row(db, 'FOR UPDATE');
      if (current.revision !== input.revision) throw new HttpError(409, 'Company sign-in settings changed. Reload them before saving.');
      const sameClient = current.settings?.provider === input.provider && current.settings?.clientId === input.clientId
        && (input.provider !== 'microsoft' || current.settings?.tenantId === input.tenantId);
      const secret = input.clientSecret ? encrypt(input.clientSecret) : sameClient ? current.secret_encrypted : null;
      if (!secret) throw new HttpError(422, 'Enter the client secret for this application.');
      const settings = { provider: input.provider, clientId: input.clientId,
        ...(input.provider === 'google' ? { domain: input.domain } : { tenantId: input.tenantId.toLowerCase() }) };
      const { rows: [updated] } = await db.query('UPDATE company_sign_in SET revision=$1,settings=$2,secret_encrypted=$3,last_login_at=NULL,updated_at=now() WHERE id=1 RETURNING *', [randomUUID(), settings, secret]);
      await db.query('DELETE FROM oidc_states');
      return publicSettings(updated);
    });
  }
  async function disconnect(body) {
    editable(); const { revision } = z.object({ revision: z.uuid() }).strict().parse(body);
    return transaction(pool, async db => {
      const current = await row(db, 'FOR UPDATE');
      if (current.revision !== revision) throw new HttpError(409, 'Company sign-in settings changed. Reload them before disconnecting.');
      // Serialize with role changes so disconnect cannot race the last recovery admin's demotion.
      await db.query('SELECT pg_advisory_xact_lock(762913)');
      if (!(await db.query("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL AND password_hash IS NOT NULL AND NOT must_change_password LIMIT 1")).rowCount)
        throw new HttpError(409, 'Create a local administrator and complete their first sign-in before disconnecting company sign-in.');
      const { rows: [updated] } = await db.query('UPDATE company_sign_in SET revision=$1,settings=NULL,secret_encrypted=NULL,last_login_at=NULL,enabled=false,updated_at=now() WHERE id=1 RETURNING *', [randomUUID()]);
      await db.query('DELETE FROM oidc_states');
      return publicSettings(updated);
    });
  }
  async function confirmLogin(db, active) {
    if (!active.oidcManaged) return;
    // Runs only after provider validation, in the short account-provisioning transaction.
    const current = await row(db, 'FOR UPDATE');
    if (current.revision !== active.oidcRevision || !current.settings) throw new HttpError(403, 'Company sign-in settings changed. Start again.');
    await db.query('UPDATE company_sign_in SET last_login_at=now() WHERE id=1');
  }
  async function activate(db, active) {
    if (active.oidcManaged) await db.query('UPDATE company_sign_in SET enabled=true WHERE id=1 AND revision=$1', [active.oidcRevision]);
  }
  return { read, effective, save, disconnect, confirmLogin, assertLocal, activate };
}

export function registerCompanySignIn(app, { service, auth, changed, admin, limiter }) {
  app.get('/api/admin/company-sign-in', auth, changed, admin, async (req, res) => res.json(await service.read()));
  app.put('/api/admin/company-sign-in', auth, changed, admin, limiter, async (req, res) => res.json(await service.save(req.body)));
  app.delete('/api/admin/company-sign-in', auth, changed, admin, limiter, async (req, res) => res.json(await service.disconnect(req.body)));
}
