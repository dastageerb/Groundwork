import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import argon2 from 'argon2';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { HttpError } from './retrieval.js';
import { createIndexer } from './indexer.js';
import { accessPredicate } from './access.js';
import { registerManagement, replaceDepartments } from './management.js';
import { registerOidc } from './oidc.js';
import { createCompanySignIn, registerCompanySignIn } from './company-sign-in.js';
import { registerAnswers } from './answers.js';
import { Capacity } from './capacity.js';
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
const password = z.string().min(12).max(128);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeUser = u => ({ id: u.id, name: u.name, username: u.username, email:u.email, role: u.role, departments:u.departments||[], localAccount:Boolean(u.password_hash), mustChangePassword: u.must_change_password });
export function createApp({ pool, model, config }) {
  const app = express(); const indexer = createIndexer(pool, model, config);
  app.disable('x-powered-by');
  if (config.trustedProxies?.length) app.set('trust proxy', config.trustedProxies);
  app.use(helmet(), express.json({ limit: '3mb' }), cookieParser(config.secret));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.publicUrl) return next(new HttpError(403, 'Request origin is not allowed.'));
    next();
  });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, skipSuccessfulRequests: true, keyGenerator: req => req.body?.username ? 'account:' + digest(String(req.body.username).trim().toLowerCase()) : req.signedCookies.groundwork ? 'session:' + digest(req.signedCookies.groundwork) : 'ip:' + ipKeyGenerator(req.ip), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
  // Per-account limits complement the IP limiter (Next proxies requests).
  const hashes = new Capacity(2, 8);
  async function auth(req, res, next) {
    const token = req.signedCookies.groundwork;
    if (!token) throw new HttpError(401, 'Please sign in to continue.');
    const { rows: [user] } = await pool.query('SELECT u.*,ARRAY(SELECT department_id FROM user_departments WHERE user_id=u.id) AS departments FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.auth_version=u.auth_version AND u.deleted_at IS NULL', [digest(token)]);
    if (!user) throw new HttpError(401, 'Your session expired. Please sign in again.');
    req.user = user; next();
  }
  function changed(req, res, next) { if (req.user.must_change_password) throw new HttpError(403, 'Change your temporary password to continue.'); next(); }
  function admin(req, res, next) { if (req.user.role !== 'admin') throw new HttpError(403, 'Administrator access is required.'); next(); }
  const cookieOptions = { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/', signed: true, maxAge: 8 * 60 * 60 * 1000 };
  async function session(res, user, localLogin = false) {
    const token = randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM sessions WHERE expires_at<now()');
    await transaction(pool, async db => {
      if(localLogin)await companySignIn.assertLocal(db,true);
      const {rows:[current]} = await db.query('SELECT auth_version FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [user.id]);
      if (!current || current.auth_version !== user.auth_version) throw new HttpError(401, 'Your credentials changed. Please sign in again.');
      await db.query("INSERT INTO sessions(token_hash,user_id,auth_version,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", [digest(token), user.id, current.auth_version]);
    });
    res.cookie('groundwork', token, cookieOptions);
  }
  const companySignIn=createCompanySignIn(pool,config);
  const localEnabled=()=>companySignIn.assertLocal();
  registerOidc(app,{pool,config,session,limiter:authLimiter,companySignIn,auth,changed,admin});
  registerCompanySignIn(app,{service:companySignIn,auth,changed,admin,limiter:authLimiter});
  registerManagement(app,{pool,auth,changed,admin});
  app.get('/api/auth/config',async(req,res)=>{
    const settings=await companySignIn.read();
    res.json({mode:settings.mode,companyLabel:settings.provider==='google'?'Google Workspace':settings.provider==='microsoft'?'Microsoft 365':settings.companyLabel||'Company account'});
  });
  app.get('/api/health', async (req, res) => {
    try {
      const { rows: [meta] } = await pool.query('SELECT * FROM index_meta WHERE id=1');
      const { rows: [users] } = await pool.query('SELECT EXISTS(SELECT 1 FROM users) AS initialized');
      let models = []; let ollama = 'offline';
      try { models = await model.models(); ollama = 'online'; } catch {}
      const installed = name => models.some(m=>m.name===name || m.name===name+':latest');
      const identity = models.find(m=>m.name===config.embedModel || m.name===config.embedModel+':latest');
      const matching = meta?.generation_id && meta.model===config.embedModel && meta.model_digest===identity?.digest && models.some(m=>m.name===meta.pinned_model&&m.digest===meta.model_digest);
      const ready = ollama === 'online' && installed(config.chatModel) && installed(config.embedModel) && matching;
      res.json({ status: ready ? 'ready' : 'not_ready', database: 'online', ollama, setupRequired: !users.initialized && config.authMode!=='oidc', modelsReady: installed(config.chatModel) && installed(config.embedModel), index: !meta?.generation_id ? 'empty' : !matching ? 'model_mismatch' : 'ready' });
    } catch { res.status(503).json({ status: 'unavailable', database: 'offline', error: 'Database unavailable. Check server configuration.' }); }
  });
  app.post('/api/auth/setup', authLimiter, async (req, res) => {
    await localEnabled();
    const input = z.object({ name: z.string().trim().min(1).max(100), username, password, setupCode: z.string().max(200) }).parse(req.body);
    if (!timingSafeEqual(Buffer.from(digest(input.setupCode)), Buffer.from(digest(config.setupCode)))) throw new HttpError(403, 'Incorrect setup code.');
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(762912)');
      if ((await db.query('SELECT id FROM users LIMIT 1')).rowCount) throw new HttpError(409, 'Setup has already been completed.');
      return (await db.query("INSERT INTO users(id,name,username,password_hash,role) VALUES($1,$2,$3,$4,'admin') RETURNING *", [randomUUID(), input.name, input.username, hash])).rows[0];
    });
    await session(res, user, true); res.status(201).json(safeUser(user));
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    await localEnabled();
    const input = z.object({ username, password: z.string().min(1).max(128) }).parse(req.body);
    const key = digest(input.username);
    await pool.query('DELETE FROM auth_attempts WHERE expires_at<now()');
    const {rows:[attempt]} = await pool.query("INSERT INTO auth_attempts(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=auth_attempts.count+1 RETURNING count", [key]);
    if (attempt.count>5) throw new HttpError(429, 'Too many attempts for this account. Try again in 15 minutes.');
    const { rows: [user] } = await pool.query('SELECT * FROM users WHERE username=$1 AND deleted_at IS NULL', [input.username]);
    const verified = await hashes.run(async () => { const hash = user?.password_hash || await argon2.hash(randomBytes(24), {type:argon2.argon2id}); return await argon2.verify(hash,input.password); }, AbortSignal.timeout(30000));
    if (!verified || !user?.password_hash) throw new HttpError(401, 'Username or password is incorrect.');
    await pool.query('DELETE FROM auth_attempts WHERE key=$1',[key]); await session(res, user, true); res.json(safeUser(user));
  });
  app.post('/api/auth/logout', auth, async (req, res) => { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(req.signedCookies.groundwork)]); res.clearCookie('groundwork', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true }); });
  app.get('/api/me', auth, (req, res) => res.json(safeUser(req.user)));
  app.post('/api/auth/change-password', auth, authLimiter, async (req, res) => {
    if(!req.user.password_hash)throw new HttpError(403,'Manage your password with your company identity provider.');
    const input = z.object({ currentPassword: z.string().max(128), password }).parse(req.body);
    if (!(await argon2.verify(req.user.password_hash, input.currentPassword))) throw new HttpError(401, 'Current password is incorrect.');
    if (input.currentPassword === input.password) throw new HttpError(422, 'Choose a different password.');
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const updated = await transaction(pool, async db => {
      const {rows:[current]} = await db.query('SELECT auth_version FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.user.id]);
      if (!current || current.auth_version!==req.user.auth_version) throw new HttpError(401,'Your credentials changed. Sign in again.');
      const {rows:[user]} = await db.query('UPDATE users SET password_hash=$2,must_change_password=false,auth_version=auth_version+1 WHERE id=$1 RETURNING *',[req.user.id,hash]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]); return user;
    });
    await session(res, updated); res.json({ ok: true });
  });
  app.get('/api/documents', auth, changed, async (req, res) => {
    res.json((await pool.query(`SELECT d.id,d.title,d.category,d.version,d.visibility,d.needs_index,d.indexed_at,count(c.id)::int AS chunks FROM documents d LEFT JOIN chunks c ON c.document_id=d.id AND c.generation_id=(SELECT generation_id FROM index_meta WHERE id=1) AND c.document_revision=d.revision AND NOT d.needs_index WHERE ${accessPredicate('d','$1')} GROUP BY d.id ORDER BY d.title`,[req.user.id])).rows);
  });
  app.get('/api/documents/:id', auth, changed, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const {rows:[doc]} = await pool.query(`SELECT d.id,d.title,d.category,d.version,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'breadcrumb',c.breadcrumb,'content',c.content) ORDER BY c.ordinal)
      FROM chunks c WHERE c.document_id=d.id AND c.generation_id=(SELECT generation_id FROM index_meta WHERE id=1)
      AND c.document_revision=d.revision AND NOT d.needs_index),'[]'::jsonb) AS sections
      FROM documents d WHERE d.id=$1 AND ${accessPredicate('d','$2')}`,[id,req.user.id]);
    if (!doc) throw new HttpError(404,'Document not found.');
    res.json(doc);
  });
  app.get('/api/users', auth, changed, admin, async (req, res) => res.json((await pool.query('SELECT u.*,ARRAY(SELECT department_id FROM user_departments WHERE user_id=u.id) AS departments FROM users u WHERE u.deleted_at IS NULL ORDER BY created_at')).rows.map(safeUser)));
  app.post('/api/users', auth, changed, admin, async (req, res) => {
    await localEnabled();
    const input = z.object({ name: z.string().trim().min(1).max(100), username, email:z.email().toLowerCase().optional(),departments:z.array(z.uuid()).max(100).default([]),role: z.enum(['admin', 'member']).default('member') }).parse(req.body);
    const temporaryPassword = randomBytes(18).toString('base64url');
    const hash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    const user=await transaction(pool,async db=>{const {rows:[user]}=await db.query('INSERT INTO users(id,name,username,role,password_hash,must_change_password,email) VALUES($1,$2,$3,$4,$5,true,$6) RETURNING *',[randomUUID(),input.name,input.username,input.role,hash,input.email||null]);await replaceDepartments(db,'user_departments','user_id',user.id,input.departments);return {...user,departments:input.departments};});
    res.status(201).json({ ...safeUser(user), temporaryPassword });
  });
  app.patch('/api/users/:id', auth, changed, admin, async (req, res) => {
    const id = z.uuid().parse(req.params.id); const input = z.object({ role: z.enum(['admin', 'member']).optional(), departments:z.array(z.uuid()).max(100).optional(),email:z.email().toLowerCase().nullable().optional(),resetPassword: z.literal(true).optional() }).refine(v => v.role || v.resetPassword || v.departments!==undefined || v.email!==undefined).parse(req.body);
    if(input.resetPassword)await localEnabled();
    const temporaryPassword = input.resetPassword ? randomBytes(18).toString('base64url') : undefined;
    const hash = temporaryPassword ? await argon2.hash(temporaryPassword, { type: argon2.argon2id }) : undefined;
    await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(762913)');
      const { rows: [target] } = await db.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (!target) throw new HttpError(404, 'User not found.');
      if(hash && (!target.password_hash || config.authMode==='oidc'))throw new HttpError(422,'Company account passwords are managed by your identity provider.');
      if (target.role === 'admin' && input.role === 'member' && (await db.query("SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL")).rowCount <= 1) throw new HttpError(409, 'At least one administrator must remain.');
      if (input.role) await db.query('UPDATE users SET role=$2 WHERE id=$1', [id, input.role]);
      if(input.email!==undefined)await db.query('UPDATE users SET email=$2 WHERE id=$1',[id,input.email]);
      if(input.departments!==undefined)await replaceDepartments(db,'user_departments','user_id',id,input.departments);
      if (hash) { await db.query('UPDATE users SET password_hash=$2,must_change_password=true,auth_version=auth_version+1 WHERE id=$1', [id, hash]); await db.query('DELETE FROM sessions WHERE user_id=$1', [id]); }
    });
    res.json({ ok: true, temporaryPassword });
  });
  app.delete('/api/users/:id', auth, changed, admin, async (req, res) => {
    const id=z.uuid().parse(req.params.id);
    await transaction(pool,async db=>{
      // Share the role-change lock so simultaneous removals/demotions cannot remove the last admin.
      await db.query('SELECT pg_advisory_xact_lock(762913)');
      const {rows:[actor]}=await db.query('SELECT role,deleted_at FROM users WHERE id=$1 FOR SHARE',[req.user.id]);
      if(!actor||actor.deleted_at||actor.role!=='admin')throw new HttpError(403,'Administrator access is required.');
      const {rows:[target]}=await db.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[id]);
      if(!target)throw new HttpError(404,'User not found.');
      if(target.role==='admin') {
        const {rows:[others]}=await db.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE password_hash IS NOT NULL AND NOT must_change_password)::int AS local FROM users WHERE role='admin' AND deleted_at IS NULL AND id<>$1",[id]);
        if(!others.total)throw new HttpError(409,'You cannot delete the last administrator. Make another person an administrator first.');
        if(target.password_hash&&!target.must_change_password&&!others.local)throw new HttpError(409,'Keep a local administrator for recovery. Create another local administrator before deleting this account.');
      }
      await db.query('UPDATE users SET deleted_at=now(),auth_version=auth_version+1,password_hash=NULL WHERE id=$1',[id]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);
      await db.query('DELETE FROM user_departments WHERE user_id=$1',[id]);
      await db.query('DELETE FROM oidc_states WHERE verification_user_id=$1',[id]);
    });
    if(id===req.user.id)res.clearCookie('groundwork',{...cookieOptions,maxAge:undefined});
    res.json({ok:true});
  });
  app.post('/api/index/rebuild', auth, changed, admin, async (req, res) => res.status(202).json(await indexer.start()));
  app.get('/api/index/status', auth, changed, admin, async (req, res) => {
    const { rows: [job] } = await pool.query('SELECT * FROM index_jobs ORDER BY started_at DESC LIMIT 1');
    const { rows: [meta] } = await pool.query('SELECT * FROM index_meta WHERE id=1');
    res.json({ job: job || null, meta: meta || null, configuredModel: config.embedModel });
  });
  const chatLimiter = rateLimit({ windowMs: 60000, limit: 20, keyGenerator: req => req.user.id, message: { error: 'Please wait a minute before asking more questions.' } });
  registerAnswers(app, {pool, model, config, auth, changed, limiter:chatLimiter});
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof z.ZodError ? 422 : error.code === '23505' ? 409 : error.status || 500;
    const message = error instanceof z.ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : error.code === '23505' ? 'That name or email is already in use.' : status < 500 ? error.message : 'The server could not complete this request. Check the server logs.';
    if (status >= 500) console.error(error.message);
    res.status(status).json({ error: message });
  });
  return app;
}
