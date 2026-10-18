import { configuration } from './config.js';
import { database, migrate } from './db.js';
import { Ollama } from './ollama.js';
import { createApp } from './app.js';
const config = configuration();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const pool = database(config.databaseUrl);
await migrate(pool);
// Reclaim expired leases only; active workers heartbeat independently.
await pool.query("UPDATE index_jobs SET status='failed',finished_at=now(),message='Worker interrupted. Rebuild to retry.' WHERE status='running' AND heartbeat_at<now()-interval '2 minutes'");
await pool.query("UPDATE audit_log SET outcome='failed',finished_at=now() WHERE outcome='pending' AND created_at<now()-interval '10 minutes'");
const maintenance = setInterval(async () => {
  try {
    await pool.query("UPDATE index_jobs SET status='failed',finished_at=now(),message='Worker lease expired. Rebuild to retry.' WHERE status='running' AND heartbeat_at<now()-interval '2 minutes'");
    await pool.query("UPDATE audit_log SET outcome='failed',finished_at=now() WHERE outcome='pending' AND created_at<now()-interval '10 minutes'");
    await pool.query("DELETE FROM audit_log WHERE created_at<now()-($1::int * interval '1 day')",[config.auditRetentionDays]);
    await pool.query("DELETE FROM sessions WHERE expires_at<now()");
    await pool.query("DELETE FROM auth_attempts WHERE expires_at<now()");
    await pool.query("UPDATE index_generations g SET status='failed' WHERE status='staging' AND NOT EXISTS(SELECT 1 FROM index_jobs j WHERE j.id=g.id AND j.status='running' AND j.heartbeat_at>now()-interval '2 minutes')");
  } catch(error) { console.error('Maintenance deferred:', error.message); }
},60000);
maintenance.unref();
const model = new Ollama(config);
if (!(await pool.query('SELECT id FROM users LIMIT 1')).rowCount) console.log(`Groundwork first-admin setup code: ${config.setupCode}`);
const server = createApp({ pool, model, config }).listen(config.port, '0.0.0.0', () => console.log(`Groundwork API listening on ${config.port}`));
if (config.autoPull) void (async () => {
  for (const name of [config.embedModel, config.chatModel]) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { console.log(`Preparing local model ${name}`); if (!(await model.tags()).some(tag=>tag===name || tag===name+':latest')) await model.pull(name); break; }
      catch (error) { console.error(error.message); if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 10000)); }
    }
  }
})();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(maintenance); server.close(async () => { await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); });
