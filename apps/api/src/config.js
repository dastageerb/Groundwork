import { randomBytes } from 'node:crypto';
import path from 'node:path';
export function configuration(env = process.env) {
  const threshold = Number(env.SIMILARITY_THRESHOLD ?? 0.55);
  const topK = Number(env.TOP_K ?? 4);
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('SIMILARITY_THRESHOLD must be between -1 and 1');
  if (!Number.isInteger(topK) || topK < 1 || topK > 12) throw new Error('TOP_K must be between 1 and 12');
  const contextTokens = Number(env.CHAT_CONTEXT_TOKENS || 8192);
  const answerTokens = Number(env.CHAT_OUTPUT_TOKENS || 1200);
  const modelConcurrency = Number(env.MODEL_CONCURRENCY || 2);
  if (!Number.isInteger(contextTokens) || contextTokens < 4096 || contextTokens > 65536 || !Number.isInteger(answerTokens) || answerTokens < 256 || answerTokens > contextTokens / 2) throw new Error('Invalid chat context/output budget');
  if (!Number.isInteger(modelConcurrency) || modelConcurrency<1 || modelConcurrency>8) throw new Error('MODEL_CONCURRENCY must be 1 to 8');
  const auditRetentionDays=Number(env.AUDIT_RETENTION_DAYS||90);
  if(!Number.isInteger(auditRetentionDays)||auditRetentionDays<1||auditRetentionDays>3650)throw new Error('AUDIT_RETENTION_DAYS must be 1 to 3650');
  const trustedProxies = (env.TRUSTED_PROXIES || '').split(',').map(v=>v.trim()).filter(Boolean);
  const authMode = env.AUTH_MODE || 'local';
  if (!['local','oidc','both'].includes(authMode)) throw new Error('AUTH_MODE must be local, oidc, or both');
  if (authMode !== 'local') {
    for (const key of ['OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET']) if (!env[key]) throw new Error(`${key} is required for company sign-in`);
    if (!env.OIDC_ALLOWED_DOMAIN && !env.OIDC_ALLOWED_TENANT) throw new Error('Configure OIDC_ALLOWED_DOMAIN or OIDC_ALLOWED_TENANT');
    if (authMode === 'oidc' && !env.ADMIN_EMAILS && !env.OIDC_ADMIN_SUBJECTS) throw new Error('ADMIN_EMAILS or OIDC_ADMIN_SUBJECTS is required in OIDC-only mode');
    if (new URL(env.OIDC_ISSUER).protocol !== 'https:' && env.OIDC_ALLOW_HTTP !== 'true') throw new Error('OIDC requires HTTPS; OIDC_ALLOW_HTTP is for local Keycloak testing only');
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-')) throw new Error('Set SESSION_SECRET to a random secret of at least 32 characters');
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:3000');
  return { auditRetentionDays, contextTokens, answerTokens, modelConcurrency, trustedProxies, authMode, oidcIssuer: env.OIDC_ISSUER, oidcClientId: env.OIDC_CLIENT_ID, oidcClientSecret: env.OIDC_CLIENT_SECRET, oidcAllowedDomain: env.OIDC_ALLOWED_DOMAIN?.toLowerCase(), oidcAllowedTenant: env.OIDC_ALLOWED_TENANT, oidcAllowHttp: env.OIDC_ALLOW_HTTP === 'true', oidcLabel: env.OIDC_LABEL || 'Company account', adminEmails: (env.ADMIN_EMAILS || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),
    oidcAdminSubjects:(env.OIDC_ADMIN_SUBJECTS||'').split(',').map(v=>v.trim()).filter(Boolean),
    databaseUrl: env.DATABASE_URL, port: Number(env.PORT || 3001), publicUrl: publicUrl.origin, secure: publicUrl.protocol === 'https:', secret: env.SESSION_SECRET, setupCode: env.SETUP_CODE || randomBytes(18).toString('base64url'), docsPath: path.resolve(env.DOCS_PATH || '../../sample-docs'), ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434', chatModel: env.CHAT_MODEL || 'llama3.2:3b', embedModel: env.EMBED_MODEL || 'nomic-embed-text', threshold, topK, autoPull: env.AUTO_PULL_MODELS === 'true' };
}
