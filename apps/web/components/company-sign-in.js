'use client';
import { useEffect, useRef, useState } from 'react';
import { Building2, Copy, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

export default function CompanySignIn({ onboarding = false, onContinue, initialProvider = 'local' }) {
  const initialSelection = useRef(onboarding ? initialProvider : 'local');
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState(onboarding ? initialProvider : 'local');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [domain, setDomain] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  function apply(value) {
    setSettings(value); setProvider(value.provider || initialSelection.current); setClientId(value.clientId || '');
    initialSelection.current = 'local';
    setDomain(value.domain || ''); setTenantId(value.tenantId || ''); setSecret('');
  }
  async function load() { setError(''); try { const value=await api('/admin/company-sign-in'); apply(value); if(value.lastLoginAt && new URLSearchParams(window.location.search).get('company-signin')==='verified')setNotice('Company sign-in is connected. Everyone now signs in with your company provider.'); if(new URLSearchParams(window.location.search).get('company-signin')==='failed')setError('The company connection failed. Check the credentials and redirect URL, then connect with your administrator company account. No new connection was activated.'); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault();
    if(provider==='local')return disconnect();
    setBusy(true); setError(''); setNotice('');
    try {
      apply(await api('/admin/company-sign-in', { method: 'PUT', body: JSON.stringify({ revision: settings.revision,
        provider, clientId, ...(secret ? { clientSecret: secret } : {}), ...(provider === 'google' ? { domain } : { tenantId }) }) }));
      setEditing(false); setNotice('Saved. Connect your administrator company account to finish setup.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (settings.enabled && !window.confirm('Switch to local accounts? Company sign-in will stop. Employees will need a local username and password. Existing sessions remain active until they expire.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      apply(await api('/admin/company-sign-in', { method: 'DELETE', body: JSON.stringify({ revision: settings.revision }) }));
      setProvider('local'); setEditing(false); setNotice('Local accounts are enabled. Add people and assign departments in People.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function copyCallback() {
    try { await navigator.clipboard.writeText(settings.callbackUrl); setCopied(true); }
    catch { setError('Select and copy the redirect URL below.'); }
  }
  const google = provider === 'google';
  const hasSavedSecret = settings?.hasSecret && settings.provider === provider && settings.clientId === clientId
    && (google || settings.tenantId === tenantId);
  const showForm = settings?.editable && (editing || !settings.configured);
  return <section className="company-settings" aria-labelledby="company-sign-in-heading">
    <header><Building2 size={22}/><div><h2 id="company-sign-in-heading">{onboarding ? 'How will your team sign in?' : 'Team sign-in'}</h2>
      <p>Use company accounts or manage usernames and passwords in Groundwork.</p></div></header>
    {error && <div className="error" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={load}>Reload settings</button></div>}
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {!settings && !error && <p className="muted">Loading sign-in settings…</p>}
    {settings && !settings.editable && <p className="small-copy">{settings.companyLabel} is configured on the server. Your server administrator can change the provider settings.</p>}
    {settings?.configured && <div className="company-connection">
      <div><strong>{settings.provider === 'google' ? 'Google Workspace' : settings.provider === 'microsoft' ? 'Microsoft 365' : settings.companyLabel}</strong>
        <p>{settings.domain || (settings.tenantId ? `Tenant: ${settings.tenantId}` : 'Managed on the server')}</p>
        {settings.editable && <small>{settings.lastLoginAt ? `Last successful sign-in: ${new Date(settings.lastLoginAt).toLocaleString()}` : 'Saved · connect your company account to finish'}</small>}</div>
      <div className="actions"><a className="button small outline" href="/api/auth/oidc/login?verify=1" target="_blank" rel="noopener noreferrer">{settings.editable?'Connect company account':'Check sign-in'}<ExternalLink size={13}/></a>
        {settings.editable && <button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(!editing); setSecret(''); }}>{editing ? 'Close editor' : 'Edit'}</button>}
        <button type="button" className="text-button" disabled={busy} onClick={load}>Refresh status</button></div>
    </div>}
    {settings?.configured && settings.editable && <p className="company-activation-note">{settings.enabled ? 'Company-only sign-in is enabled. The login page shows only your selected provider.' : 'Connect with the company account you will use as administrator. Once it succeeds, everyone will use this provider and password login will be disabled.'}</p>}
    {showForm && <form onSubmit={save} className="company-sign-in-form">
      <fieldset disabled={busy}>
        <label>Sign-in method<select value={provider} onChange={e => { setProvider(e.target.value); setClientId(''); setSecret(''); }}>
          <option value="local">No workspace — local accounts</option><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365 / Teams</option>
        </select></label>
        {provider==='local'?<p className="small-copy">No Google or Microsoft workspace is needed. People sign in with a Groundwork username and password. Administrators create accounts and assign departments in People.</p>:<>
        <details className="provider-instructions" open={!settings.enabled}>
          <summary>Set up {google ? 'Google Workspace' : 'Microsoft 365'}</summary>
          {google ? <ol>
            <li>In <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform<ExternalLink size={12}/></a>, select your organization’s project and configure the app’s branding. Choose an Internal audience for your organization.</li>
            <li>Create a Web application OAuth client. Add the redirect URL below to Authorized redirect URIs.</li>
            <li>Copy the client ID and client secret here, then enter your Google Workspace domain.</li>
          </ol> : <ol>
            <li>In the <a href="https://entra.microsoft.com/" target="_blank" rel="noopener noreferrer">Microsoft Entra admin center<ExternalLink size={12}/></a>, open App registrations and register Groundwork for accounts in your organizational directory only.</li>
            <li>Add a Web redirect URI using the URL below. Copy the Application (client) ID and Directory (tenant) ID.</li>
            <li>Under Certificates &amp; secrets, create a client secret. Paste its <strong>Value</strong> here, not its Secret ID.</li>
          </ol>}
        </details>
        <label>Redirect URL<div className="callback-field"><input aria-label="Redirect URL" readOnly value={settings.callbackUrl} onFocus={e => e.target.select()}/><button type="button" className="icon-button" aria-label="Copy redirect URL" onClick={copyCallback}><Copy size={16}/></button></div><small aria-live="polite">{copied ? 'Copied.' : 'Use this exact URL in your provider’s app registration.'}</small></label>
        {google ? <label>Google Workspace domain<input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" required maxLength={253} autoCapitalize="none" spellCheck={false}/></label>
          : <label>Directory (tenant) ID<input value={tenantId} onChange={e => setTenantId(e.target.value.trim())} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required autoCapitalize="none" spellCheck={false}/></label>}
        <label>{google ? 'Client ID' : 'Application (client) ID'}<input value={clientId} onChange={e => setClientId(e.target.value.trim())} required maxLength={512} autoCapitalize="none" spellCheck={false}/></label>
        <label>Client secret<input type="password" value={secret} onChange={e => setSecret(e.target.value)} required={!hasSavedSecret} maxLength={4096} autoComplete="new-password" placeholder={hasSavedSecret ? 'Leave blank to keep the saved secret' : 'Paste the client secret'}/></label>
        <p className="small-copy">Your connected company account keeps administrator access. New employees join as members; assign their departments in People.</p>
        </>}
        <div className="actions"><button className="button small" disabled={busy}>{busy ? 'Saving…' : provider==='local'?'Use local accounts':'Save company sign-in'}</button>
          {editing && <button className="button small outline" type="button" onClick={() => { apply(settings); setEditing(false); }}>Cancel</button>}</div>
      </fieldset>
    </form>}
    {settings?.editable && settings.configured && <div className="company-sign-in-footer"><p>Disconnecting restores local sign-in. Existing accounts and sessions are kept.</p><button type="button" className="text-button danger-text" disabled={busy} onClick={disconnect}>Disconnect</button></div>}
    {onboarding && <div className="company-onboarding-footer"><p>You can change this later in Settings.</p><button type="button" className="button small outline" disabled={busy} onClick={onContinue}>{settings?.enabled ? 'Continue to workspace' : 'Use local accounts for now'}</button></div>}
  </section>;
}
