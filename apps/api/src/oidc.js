import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { HttpError } from './retrieval.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function validateOrganization(claims,config) {
  if(!claims?.sub)throw new HttpError(403,'The identity provider did not return a subject.');
  const email=typeof claims.email==='string'?claims.email.toLowerCase():null;
  const google=config.oidcProvider==='google'||config.oidcIssuer==='https://accounts.google.com';
  const microsoft=config.oidcProvider==='microsoft'||/^https:\/\/login\.microsoftonline\.com\//.test(config.oidcIssuer||'');
  const verified=claims.email_verified===true && !microsoft && (!google||typeof claims.hd==='string');
  if(config.oidcAllowedTenant && claims.tid!==config.oidcAllowedTenant)throw new HttpError(403,'This account is outside your organization.');
  if(google && config.oidcAllowedDomain && claims.hd!==config.oidcAllowedDomain)throw new HttpError(403,'Use an account from your Google Workspace organization.');
  if(config.oidcAllowedDomain && (!verified || (!google && email?.split('@')[1]!==config.oidcAllowedDomain)))throw new HttpError(403,'A verified company email address is required.');
  const isAdmin=(verified && config.adminEmails?.includes(email)) || (config.oidcAdminSubjects?.includes(claims.sub));
  return {email:verified?email:null,isAdmin:Boolean(isAdmin)};
}
export function registerOidc(app,{pool,config,session,limiter,companySignIn,auth,changed,admin}) {
  let discovery;
  async function provider(active) {
    if(!discovery||discovery.revision!==active.oidcRevision) {
      const entry={revision:active.oidcRevision};
      entry.promise=(async()=>{
      const client=await import('openid-client');
      const execute=[client.enableNonRepudiationChecks];
      if(active.oidcAllowHttp)execute.push(client.allowInsecureRequests);
      const connection=await client.discovery(new URL(active.oidcIssuer),active.oidcClientId,active.oidcClientSecret,undefined,{execute});
      return {client,connection};
      })().catch(error=>{if(discovery===entry)discovery=null;throw error;});
      discovery=entry;
    }
    return discovery.promise;
  }
  const enabled=(active,verifying=false)=>{if(!['oidc','both'].includes(active.authMode)&&!(verifying&&active.oidcConfigured))throw new HttpError(404,'Company sign-in is not enabled.');};
  const options={httpOnly:true,secure:config.secure,sameSite:'lax',signed:true,path:'/api/auth/oidc',maxAge:600000};
  app.get('/api/auth/oidc/login',limiter,(req,res,next)=>req.query.verify==='1'?auth(req,res,next):next(),async(req,res)=>{
    const verifying=req.query.verify==='1';
    if(verifying){changed(req,res,()=>{});admin(req,res,()=>{});}
    try {
    const active=await companySignIn.effective();enabled(active,verifying);const {client,connection}=await provider(active);
    const id=randomBytes(32).toString('base64url');const state=client.randomState();const nonce=client.randomNonce();const verifier=client.randomPKCECodeVerifier();
    await pool.query('DELETE FROM oidc_states WHERE expires_at<now()');
    await pool.query("INSERT INTO oidc_states(id_hash,state,nonce,verifier,expires_at,config_revision,verification_user_id,verification_auth_version) VALUES($1,$2,$3,$4,now()+interval '10 minutes',$5,$6,$7)",[hash(id),state,nonce,verifier,active.oidcRevision,verifying?req.user.id:null,verifying?req.user.auth_version:null]);
    res.cookie('groundwork_oidc',id,options);
    const url=client.buildAuthorizationUrl(connection,{redirect_uri:`${config.publicUrl}/api/auth/oidc/callback`,scope:'openid email profile',state,nonce,code_challenge:await client.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(verifying?{prompt:'select_account'}:{}),...(active.oidcProvider==='google'?{hd:active.oidcAllowedDomain}:{})});
    res.redirect(url.href);
    } catch {
      res.clearCookie('groundwork_oidc',{...options,maxAge:undefined});
      console.error('Company sign-in could not start. Check provider configuration and connectivity.');
      res.redirect(verifying?'/workspace?company-signin=failed':'/workspace?signin=failed');
    }
  });
  app.get('/api/auth/oidc/callback',limiter,async(req,res)=>{
    let verifying=false;
    try {
      const id=req.signedCookies.groundwork_oidc;
      if(!id)throw new HttpError(403,'Sign-in state is missing. Start again.');
      const {rows:[state]}=await pool.query('DELETE FROM oidc_states WHERE id_hash=$1 AND expires_at>now() RETURNING *',[hash(id)]);
      res.clearCookie('groundwork_oidc',{...options,maxAge:undefined});
      if(!state)throw new HttpError(403,'Sign-in expired or was already used. Start again.');
      verifying=Boolean(state.verification_user_id);
      const active=await companySignIn.effective();enabled(active,verifying);
      if(state.config_revision!==active.oidcRevision)throw new HttpError(403,'Company sign-in settings changed. Start again.');
      const {client,connection}=await provider(active);
      const tokens=await client.authorizationCodeGrant(connection,new URL(req.originalUrl,config.publicUrl),{pkceCodeVerifier:state.verifier,expectedState:state.state,expectedNonce:state.nonce,idTokenExpected:true});
      const claims=tokens.claims();const identity=validateOrganization(claims,active);
      if(state.verification_user_id) {
        await transaction(pool,async db=>{
          await companySignIn.confirmLogin(db,active);
          await db.query('SELECT pg_advisory_xact_lock(762912)');
          const {rows:[user]}=await db.query('SELECT role,auth_version FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[state.verification_user_id]);
          if(!user||user.role!=='admin'||user.auth_version!==state.verification_auth_version)throw new HttpError(403,'Administrator credentials changed. Start again.');
          if(active.oidcManaged) {
            // The authenticated admin explicitly connects their own provider identity.
            // Never transfer an identity already belonging to another account.
            const {rows:[linked]}=await db.query('SELECT user_id,subject FROM oidc_identities WHERE issuer=$1 AND (subject=$2 OR user_id=$3)',[claims.iss,claims.sub,state.verification_user_id]);
            if(linked&&(linked.user_id!==state.verification_user_id||linked.subject!==claims.sub))throw new HttpError(409,'This company account is already linked, or this administrator has another company identity. Use the original company account.');
            if(!linked)await db.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)',[claims.iss,claims.sub,state.verification_user_id]);
            await companySignIn.activate(db,active);
          }
        });
        return res.redirect('/workspace?company-signin=verified');
      }
      const user=await transaction(pool,async db=>{
        await companySignIn.confirmLogin(db,active);
        await db.query('SELECT pg_advisory_xact_lock(762912)');
        let {rows:[user]}=await db.query('SELECT u.* FROM oidc_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 FOR UPDATE OF u',[claims.iss,claims.sub]);
        if(user?.deleted_at)throw new HttpError(403,'This account has been removed. Contact your administrator.');
        if(user) {
          if(user.must_change_password) {
            user=(await db.query('UPDATE users SET password_hash=NULL,must_change_password=false,auth_version=auth_version+1 WHERE id=$1 RETURNING *',[user.id])).rows[0];
            await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
          }
          return user;
        }
        // Link only provider-verified email to an admin-provisioned local email.
        if(identity.email)user=(await db.query('SELECT * FROM users WHERE lower(email)=$1 FOR UPDATE',[identity.email])).rows[0];
        if(user?.deleted_at)throw new HttpError(403,'This account has been removed. Contact your administrator.');
        if(!user)user=(await db.query('INSERT INTO users(id,name,username,email,role,password_hash) VALUES($1,$2,$3,$4,$5,NULL) RETURNING *',[randomUUID(),String(claims.name||identity.email||'Company member').slice(0,100),`sso-${randomBytes(12).toString('hex')}`,identity.email,identity.isAdmin?'admin':'member'])).rows[0];
        // A verified company login disables any outstanding temporary local credential.
        if(user.must_change_password) {
          user=(await db.query('UPDATE users SET password_hash=NULL,must_change_password=false,auth_version=auth_version+1 WHERE id=$1 RETURNING *',[user.id])).rows[0];
          await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
        }
        await db.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)',[claims.iss,claims.sub,user.id]);
        return user;
      });
      await session(res,user);res.redirect('/workspace');
    }catch(error){res.clearCookie('groundwork_oidc',{...options,maxAge:undefined});console.error('Company sign-in failed:',error.status?error.message:'Provider validation failed');res.redirect(verifying?'/workspace?company-signin=failed':'/workspace?signin=failed');}
  });
}
