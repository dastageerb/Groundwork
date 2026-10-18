'use client';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Files, Users, Settings2, ArrowUp, ArrowRight, LogOut, Plus, Search, FileText, LockKeyhole, ShieldCheck, X, Menu, ChevronRight, Square, KeyRound, AlertCircle } from 'lucide-react';
import { DocumentManager, Feedback, AuditPanel, EmbedPanel } from '../../components/administration';
import Brand from '../../components/brand';
import People from '../../components/people';
import CompanySignIn from '../../components/company-sign-in';
import { api, streamQuestion } from '../../lib/api';
const prompts = ['When can I start taking annual leave?', 'How do I submit an expense claim?', 'What is our remote work policy?', 'How do I report a security incident?'];
export default function Workspace({ embedded = false }) {
  const [companyOnboarding, setCompanyOnboarding] = useState(false);
  const [companyProvider, setCompanyProvider] = useState('local');
  const [user, setUser] = useState(null); const [health, setHealth] = useState(null); const [booting, setBooting] = useState(true); const [error, setError] = useState(''); const [view, setView] = useState('chat'); const [mobile, setMobile] = useState(false); const [source, setSource] = useState(null);
  async function boot() {
    setError('');
    try { const h = await api('/health'); setHealth(h); try { setUser(await api('/me')); } catch (e) { if (e.status !== 401) throw e; setUser(null); } }
    catch (e) { setError(e.message); } finally { setBooting(false); }
  }
  useEffect(() => { boot(); }, []);
  useEffect(() => { if(['verified','failed'].includes(new URLSearchParams(window.location.search).get('company-signin')))setView('settings'); }, []);
  useEffect(() => { const timer = setInterval(() => api('/health').then(setHealth).catch(() => setHealth(null)), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { const expired=()=>{setUser(null);setView('chat');};window.addEventListener('groundwork:expired',expired);return()=>window.removeEventListener('groundwork:expired',expired);},[]);
  useEffect(() => { if(user?.role!=='admin'&&['users','audit'].includes(view))setView('chat'); },[user?.role,view]);
  async function logout() { try { await api('/auth/logout', { method: 'POST' }); setUser(null); setView('chat'); } catch(e) { if(e.status===401){setUser(null);setView('chat');}else setError(e.message); } }
  if (booting) return <div className="auth-page"><Brand/><p>Connecting to your workspace…</p></div>;
  if (!user) return <Auth health={health} error={error} onSuccess={async (setup,provider)=>{await boot();setCompanyOnboarding(false);setCompanyProvider('local');if(setup&&provider!=='local'){setCompanyProvider(provider);setCompanyOnboarding(true);setView('settings');}}} retry={boot}/>;
  if (user.mustChangePassword) return <PasswordChange forced onDone={boot} onLogout={logout}/>;
  const tabs = [[MessageSquare,'chat','Ask Groundwork'],[Files,'documents','Documents'], ...(user.role === 'admin' ? [[Users,'users','People'],[FileText,'audit','Answer activity']] : [])];
  const navigate = key => { setView(key); setMobile(false); if(key!=='settings')setCompanyOnboarding(false); };
  return <div className={"workspace "+(embedded?"embedded-workspace":"")}>
    <aside className={`sidebar ${mobile ? 'open' : ''}`}>
      <Brand/><span className="workspace-label">YOUR WORKSPACE <span>LOCAL</span></span>
      <button className="button new-chat" onClick={() => { navigate('chat'); window.dispatchEvent(new Event('groundwork:new-chat')); }}><Plus size={17}/>New conversation</button>
      <nav aria-label="Workspace navigation">{tabs.map(([Icon,key,label]) => <button key={key} onClick={() => navigate(key)} aria-current={view===key?'page':undefined} className={view === key ? 'active' : ''}><Icon size={19}/>{label}{view === key && <ChevronRight size={14}/>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="profile"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.role === 'admin' ? 'Administrator' : 'Team member'}</small></div><button title="Sign out" aria-label="Sign out" className="icon-button" onClick={logout}><LogOut size={17}/></button></div>
        <button className={'profile-settings '+(view==='settings'?'active':'')} onClick={()=>navigate('settings')} aria-current={view==='settings'?'page':undefined}><Settings2 size={17}/><span>Settings</span><ChevronRight size={14}/></button>
      </div>
    </aside>
    {mobile && <button aria-label="Close navigation" className="backdrop" onClick={() => setMobile(false)}/>}
    <div className="workspace-main"><header className="workspace-header"><div><button aria-label="Open navigation" className="icon-button mobile-menu" onClick={() => setMobile(!mobile)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{view==='settings'?'Settings':tabs.find(t => t[1] === view)?.[2]}</strong></div><span className={`status ${health?.status !== 'ready' ? 'warning' : ''}`}><i/>{health?.status === 'ready' ? 'Local engine ready' : health?.ollama === 'offline' ? 'Engine offline' : 'Setup needed'}</span>{embedded&&<div className="widget-actions"><button className="icon-button" aria-label="New conversation" onClick={()=>window.dispatchEvent(new Event('groundwork:new-chat'))}><Plus size={18}/></button><button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={17}/></button><a href="/workspace" target="_blank" rel="noopener noreferrer" className="text-button">Workspace</a></div>}</header>
      {error && <div className="error notice" role="alert">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}
      {view === 'chat' && <Chat health={health} onSource={setSource}/>}
      {view === 'documents' && (user.role==='admin'?<DocumentManager health={health} onUpdate={()=>api('/health').then(setHealth)} onSource={setSource}/>:<Documents onSource={setSource}/>)}
      {view === 'users' && user.role==='admin' && <People currentUser={user} onChange={boot} onCompanySetup={()=>navigate('settings')}/>}
      {view === 'audit' && user.role==='admin' && <AuditPanel/>}
      {view === 'settings' && <Settings user={user} onUpdate={boot} onboarding={companyOnboarding} initialProvider={companyProvider} onContinue={()=>{setCompanyOnboarding(false);navigate('chat');}}/>}
    </div>
    {source && <SourcePanel source={source} onClose={() => setSource(null)}/>}
  </div>;
}
function Auth({ health, error: connectionError, onSuccess, retry }) {
  const [authConfig, setAuthConfig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupProvider, setSetupProvider] = useState('local');
  const setup = health?.setupRequired;
  useEffect(() => {
    api('/auth/config').then(setAuthConfig).catch(e => setError(e.message));
    if (new URLSearchParams(window.location.search).get('signin') === 'failed') setError('Company sign-in failed. Try again or contact your administrator.');
  }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: JSON.stringify(data) });
      await onSuccess(setup, setupProvider);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="auth-page"><Brand/><div className="auth-card">
    <div className="feature-icon"><LockKeyhole size={25}/></div>
    <h1>{setup ? 'Create your workspace' : 'Welcome back.'}</h1>
    {connectionError ? (
      <div className="error" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <strong>Self-Hosted Engine Offline</strong>
        <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5 }}>
          Groundwork is self-hosted and requires Docker and local model services running on your server. To launch the backend, clone the repo and run:
        </p>
        <code style={{ background: '#fce8e8', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
          docker compose up --build
        </code>
        <div style={{ display: 'flex', gap: '14px', marginTop: '4px' }}>
          <button className="text-button" onClick={retry}>Retry connection</button>
          <a href="/" className="text-button">Return to showcase</a>
        </div>
      </div>
    ) : <>
      {authConfig && authConfig.mode !== 'local' && <div className="company-signin">
        <a className="button outline" href="/api/auth/oidc/login" target="_top">Sign in with {authConfig.companyLabel}</a>
        {authConfig.mode === 'both' && <span className="auth-method-divider">or use a local account</span>}
      </div>}
      {!authConfig && !error && <p className="auth-loading">Loading sign-in options…</p>}
      {!authConfig && error && <div className="error" role="alert">{error}<button className="text-button" onClick={()=>{setError('');api('/auth/config').then(setAuthConfig).catch(e=>setError(e.message));}}>Retry</button></div>}
      {authConfig && authConfig.mode !== 'oidc' && <form onSubmit={submit}>
        {setup && <label>Team sign-in<select value={setupProvider} onChange={e => setSetupProvider(e.target.value)}><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365 / Teams</option><option value="local">No workspace — local accounts</option></select></label>}
        {setup && <><label>Setup code<input name="setupCode" required autoComplete="off" placeholder="From your server’s startup log"/></label><label>Your name<input name="name" required maxLength={100} autoComplete="name" placeholder="Alex Morgan"/></label></>}
        <label>{setup && setupProvider!=='local'?'Administrator recovery username':'Username'}<input name="username" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" autoComplete="username" placeholder="Your work username"/></label>
        <label>{setup && setupProvider!=='local'?'Administrator recovery password':'Password'}<input name="password" type="password" required minLength={setup ? 12 : 1} maxLength={128} autoComplete={setup ? 'new-password' : 'current-password'} placeholder={setup ? 'At least 12 characters' : 'Enter your password'}/></label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="button" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create workspace' : 'Sign in'}<ArrowRight size={17}/></button>
      </form>}
      {authConfig?.mode === 'oidc' && error && <p className="error" role="alert">{error}</p>}
    </>}
    <small>{setup ? setupProvider==='local'?'You can connect a company provider later in Settings.':'Next, connect your company provider. Once connected, employees will only see company sign-in.' : authConfig && authConfig.mode !== 'local' ? 'Company accounts are created automatically on first sign-in.' : 'Need an account or a password reset? Contact your administrator.'}</small>
  </div><span className="auth-footer"><ShieldCheck size={15}/> Your company’s knowledge stays with your company.</span></main>;
}
function Chat({ health, onSource }) {
  const [messages, setMessages] = useState([]); const [question, setQuestion] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const controller = useRef(null); const end = useRef(null); const input = useRef(null);
  useEffect(() => { const reset = () => { controller.current?.abort(); setMessages([]); setQuestion(''); setError(''); input.current?.focus(); }; window.addEventListener('groundwork:new-chat', reset); return () => { window.removeEventListener('groundwork:new-chat', reset); controller.current?.abort(); }; }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'instant', block: 'end' }); }, [messages, busy]);
  async function ask(text) {
    if (!text.trim() || busy) return;
    const id = crypto.randomUUID(); setMessages(previous => [...previous, { id: `${id}-q`, role: 'user', text }, { id, role: 'assistant', text: '', sources: [] }]); setQuestion(''); setError(''); setBusy(true);
    const update = change => setMessages(previous => previous.map(m => m.id === id ? { ...m, ...change(m) } : m));
    controller.current = new AbortController();
    try { await streamQuestion(text, controller.current.signal, (event, data) => { if (event === 'status') update(()=>({statusText:data.text})); if (event === 'token') update(m => ({ text: m.text + data.text })); if (event === 'done') update(() => ({ ...data, complete: true })); }); }
    catch(e) { if (e.name !== 'AbortError') { setError(e.message); update(() => ({ failed: true })); } else update(() => ({ stopped: true })); }
    finally { setBusy(false); input.current?.focus(); }
  }
  return <section className="chat-view"><div className="chat-scroll">{messages.length === 0 ? <div className="chat-welcome"><span className="welcome-mark">✳</span><span className="eyebrow">ANSWERS, GROUNDED IN YOUR DOCUMENTS</span><h1>Good questions.<br/><span>Solid answers.</span></h1><p>From time off to the way things work.<br/>Ask a question. Get an answer you can trace.</p><div className="prompt-grid">{prompts.map((p,i) => <button key={p} onClick={() => ask(p)} disabled={busy || health?.status !== 'ready'}><span>{['People & benefits','Finance & expenses','Ways of working','IT & security'][i]}</span>{p}<ArrowRight size={16}/></button>)}</div><div className="private-note"><LockKeyhole size={13}/> Only your documents. Always on your servers.</div></div> : <div className="conversation" role="log" aria-live="polite">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className="message-label">{m.role === 'user' ? 'You' : '✳ Groundwork'}</span><div className="bubble">{m.text || (m.failed ? 'Unable to answer this question.' : m.stopped ? 'Answer stopped.' : <span className="muted"><span className="dots">● ● ●</span> {m.statusText||'Searching your documents…'}</span>)}{m.declined && <span className="declined">{m.modelCalled?'The documents did not support an answer':'Declined before chat generation'}</span>}{m.sources?.length > 0 && <div className="source-list"><small>SOURCE EXCERPTS · VERIFY THE ANSWER</small>{m.sources.map(s => <button key={s.id} className="citation" onClick={() => onSource(s)}><FileText size={14}/><span>[{s.citation}] {s.title}<small>{s.section?.startsWith(s.title+' › ')?s.section.slice(s.title.length+3):s.section}</small></span><ChevronRight size={14}/></button>)}</div>}{m.complete&&m.auditId&&<Feedback auditId={m.auditId}/>}{(m.failed || m.stopped) && m.text && <small className="error-text">{m.stopped ? 'Generation stopped — this answer is incomplete.' : 'Connection interrupted — this answer is incomplete.'}</small>}</div></div>)}</div>}<div ref={end}/></div><div className="composer-wrap">{health?.status !== 'ready' && <div className="engine-notice"><AlertCircle size={16}/>{health?.index === 'empty' ? 'Your documents need indexing. An administrator can rebuild the index in Documents.' : health?.index === 'model_mismatch' ? 'The embedding model changed. Rebuild the document index to continue.' : 'The local engine is not ready. Check Ollama and model downloads.'}</div>}{error && <div className="error" role="alert">{error}</div>}<form className="composer" onSubmit={e => { e.preventDefault(); ask(question); }}><textarea aria-label="Ask about your company documents" ref={input} rows={1} maxLength={2000} placeholder="Ask about your company’s documents…" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } }}/>{busy ? <button className="send" type="button" aria-label="Stop generating" onClick={() => controller.current?.abort()}><Square size={16}/></button> : <button className="send" aria-label="Send question" disabled={!question.trim() || health?.status !== 'ready'}><ArrowUp size={21}/></button>}</form><div className="composer-note"><span><ShieldCheck size={12}/> Private by design</span><span>Check sources for important decisions. · Enter to send</span></div></div></section>;
}
function Documents({ onSource }) {
  const [documents, setDocuments] = useState(null); const [search, setSearch] = useState(''); const [error, setError] = useState('');
  useEffect(() => { api('/documents').then(setDocuments).catch(e => setError(e.message)); }, []);
  return <section className="panel"><PanelHeading eyebrow="YOUR SOURCE OF TRUTH" title="Documents"/><div className="search-field"><Search size={17}/><input aria-label="Search documents" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a document…"/></div>{error && <div role="alert" className="error">{error}</div>}{documents === null ? !error && <p>Loading documents…</p> : <><div className="list-heading">{documents.length} DOCUMENT{documents.length !== 1 ? 'S' : ''}<span>AVAILABLE TO YOU</span></div><div className="document-grid">{documents.filter(d => d.title.toLowerCase().includes(search.toLowerCase())).map(d => <button className="document-card" key={d.id} onClick={() => onSource({ documentId: d.id, title: d.title })}><div><span className="feature-icon"><FileText size={23}/></span><span className="tag">{d.category}</span></div><h3>{d.title}</h3><p>{d.chunks} searchable sections · Version {d.version}</p><footer><span>Indexed {new Date(d.indexed_at).toLocaleDateString()}</span><ArrowRight size={17}/></footer></button>)}</div>{!documents.length && <Empty title="Your library starts here" text="Ask an administrator to add documents, grant access, and publish the index."/>}{documents.length > 0 && !documents.some(d => d.title.toLowerCase().includes(search.toLowerCase())) && <Empty title="No matching documents" text="Try another title or clear your search."/>}</> }</section>;
}
function Settings({ user, onUpdate, onboarding, onContinue, initialProvider }) {
  const [saved,setSaved]=useState(false);
  return <section className="panel account-settings"><PanelHeading eyebrow="MAKE YOURSELF AT HOME" title="Settings"/>
    {user.role==='admin'&&<CompanySignIn onboarding={onboarding} onContinue={onContinue} initialProvider={initialProvider}/>}
    {saved&&<p className="success-notice" role="status">Your password has been updated. Other sessions have been signed out.</p>}
    <div className="account-layout"><div className="account-summary"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><h2>{user.name}</h2><p>@{user.username}</p><span className="tag">{user.role==='admin'?'Administrator':'Team member'}</span><div className="account-security"><ShieldCheck size={18}/><p>{user.localAccount?'Your account uses a local password. Choose a unique password with at least 12 characters.':'Your account is managed by your company sign-in provider. Contact your administrator to update your credentials.'}</p></div></div>
      {user.localAccount?<PasswordChange inline onDone={async()=>{setSaved(true);await onUpdate();}}/>:<div className="account-provider"><LockKeyhole size={25}/><h2>Company sign-in</h2><p>Your company manages your password and sign-in security.</p></div>}
    </div>
    {user.role==='admin'&&<EmbedPanel inline/>}
  </section>;
}
function PasswordChange({ forced = false, inline = false, onDone, onLogout }) {
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  async function submit(e) { e.preventDefault(); setError(''); const form=e.currentTarget; const data = Object.fromEntries(new FormData(form)); if (data.password !== data.confirm) return setError('The new passwords do not match.'); setBusy(true); try { await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: data.currentPassword, password: data.password }) }); form.reset(); await onDone(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  return <section className={inline?'password-settings':forced ? 'auth-page' : 'panel'}>{forced && <Brand/>}<div className="auth-card"><KeyRound size={26}/><h1>{forced ? 'Make it yours.' : 'Change password'}</h1><p>{forced ? 'Choose a new password before entering your workspace.' : 'Changing your password signs out your other sessions.'}</p><form onSubmit={submit}><label>Current password<input required name="currentPassword" type="password" autoComplete="current-password" maxLength={128}/></label><label>New password<input required name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="At least 12 characters"/></label><label>Confirm new password<input required name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password"/></label>{error && <div role="alert" className="error">{error}</div>}<button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button></form>{onLogout && <button className="text-button" onClick={onLogout}>Sign out</button>}</div></section>;
}
function SourcePanel({ source, onClose }) {
  const [document,setDocument] = useState(null); const [error,setError] = useState(''); const dialog = useRef(null);
  useEffect(() => { setDocument(null); setError(''); if (!source.excerpt) api(`/documents/${source.documentId}`).then(setDocument).catch(e => setError(e.message)); }, [source]);
  useEffect(() => { const previous = window.document.activeElement; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={dialog} className="source-dialog" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="source-panel"><header><span className="eyebrow">SOURCE DOCUMENT</span><button className="icon-button" aria-label="Close source" onClick={onClose}><X size={20}/></button></header><FileText size={30}/><h2>{source.title}</h2>{error && <div role="alert" className="error">{error}</div>}{source.excerpt ? <section><h3>{source.section}</h3><pre>{source.excerpt}</pre><small>This excerpt was retrieved for your answer. Compare the answer with the source text.</small></section> : document?.sections.length===0 ? <p className="muted">This document has no published sections yet. Ask an administrator to rebuild the index.</p> : document ? document.sections.map(s => <section key={s.id}><h3>{s.breadcrumb}</h3><pre>{s.content}</pre></section>) : !error && <p>Loading document…</p>}</div></dialog>;
}
function PanelHeading({ eyebrow,title,text,children }) { return <div className="panel-heading"><div><h1>{title}</h1>{text&&<p>{text}</p>}</div>{children}</div>; }
function Empty({title,text}) { return <div className="empty"><Files size={34}/><h3>{title}</h3><p>{text}</p></div>; }
