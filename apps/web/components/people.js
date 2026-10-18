'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, KeyRound, Plus, Search, Users, X } from 'lucide-react';
import { api } from '../lib/api';
import { DepartmentPanel } from './administration';

export default function People({ currentUser, onChange, onCompanySetup }) {
  const [users, setUsers] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [authMode, setAuthMode] = useState(null);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [secret, setSecret] = useState(null);

  async function load() {
    const [people, groups] = await Promise.all([api('/users'), api('/departments')]);
    setUsers(people); setDepartments(groups);
    return groups;
  }
  useEffect(() => {
    load().catch(e => setError(e.message));
    api('/auth/config').then(c => setAuthMode(c.mode)).catch(e => setError(e.message));
  }, []);
  async function saved(result, person) {
    setEditing(null);
    if (result.temporaryPassword) setSecret({ username: person.username, password: result.temporaryPassword });
    try { await load(); if (person.id === currentUser.id) await onChange(); }
    catch (e) { setError(e.message); }
  }
  const visible = (users || []).filter(u => `${u.name} ${u.username} ${u.email || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel simple-people">
    <div className="panel-heading"><h1>People</h1>{authMode && authMode !== 'oidc' && <button className="button small" onClick={() => setEditing({ name: '', username: '', role: 'member', email: '', departments: [] })}><Plus size={16}/>Add person</button>}</div>
    {authMode && <p className="people-sign-in-note">{authMode==='local'?'Have Google Workspace or Microsoft 365? Let people join with their company accounts.':'Company accounts appear here after their first sign-in.'} <button className="text-button" onClick={onCompanySetup}>Company sign-in settings</button></p>}
    {error && <p className="error" role="alert">{error}</p>}
    {secret && <div className="secret-card" role="status"><KeyRound size={20}/><div><strong>Temporary password for {secret.username}</strong><p>Copy and share it securely. A password change is required at sign-in.</p><code>{secret.password}</code></div><button className="icon-button" aria-label="Dismiss temporary password" onClick={() => setSecret(null)}><X size={18}/></button></div>}
    <div className="user-list-surface">
      <div className="user-list-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Search people" placeholder="Search people…" value={search} onChange={e => setSearch(e.target.value)}/></div><span>{users === null ? 'Loading…' : `${users.length} ${users.length === 1 ? 'person' : 'people'}`}</span></div>
      <div className="user-list-labels" aria-hidden="true"><span>Name</span><span>Role</span><span>Departments</span><span>Status</span><span/></div>
      <ul className="user-list">{visible.map(person => <li key={person.id}><button className="user-list-row" onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}>
        <span className="person"><span className="avatar">{person.name[0]}</span><span><strong>{person.name}{person.id === currentUser.id ? ' (you)' : ''}</strong><small>{person.email || '@' + person.username}</small></span></span>
        <span className="user-role">{person.role === 'admin' ? 'Administrator' : 'Member'}</span>
        <span className="user-departments">{person.departments?.map(id => departments.find(d => d.id === id)?.name).filter(Boolean).join(', ') || 'No department'}</span>
        <span className={'tag user-status ' + (person.mustChangePassword ? 'pending' : '')}>{person.mustChangePassword ? 'Password required' : person.localAccount ? 'Active' : 'Company account'}</span><ChevronRight size={17}/>
      </button></li>)}</ul>
      {users !== null && !visible.length && <div className="simple-empty"><Users size={25}/><p>{users.length ? 'No matching people.' : 'No users yet.'}</p></div>}
    </div>
    {editing && <PersonEditor person={editing} departments={departments} authMode={authMode} onDepartmentsChanged={load} onClose={() => setEditing(null)} onSaved={saved}/>}
  </section>;
}

function PersonEditor({ person, departments, authMode, onDepartmentsChanged, onClose, onSaved }) {
  const dialog = useRef(null);
  const [ids, setIds] = useState(person.departments || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [departmentName, setDepartmentName] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const trigger = document.activeElement;
    dialog.current.showModal();
    return () => trigger?.focus();
  }, []);
  async function refreshDepartments() {
    const next = await onDepartmentsChanged();
    setIds(previous => previous.filter(id => next.some(d => d.id === id)));
  }
  async function createDepartment() {
    if (busy || !departmentName.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const group = await api('/departments', { method: 'POST', body: JSON.stringify({ name: departmentName.trim() }) });
      await onDepartmentsChanged();
      setIds(previous => [...new Set([...previous, group.id])]);
      setCreating(false); setDepartmentName(''); setNotice('Department created. Save this person to assign it.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (busy || creating) return;
    setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const body = { role: values.role, departments: ids, email: values.email.trim().toLowerCase() || null };
    if (!person.id) { body.name = values.name; body.username = values.username; if (!body.email) delete body.email; }
    try {
      const result = await api('/users' + (person.id ? '/' + person.id : ''), { method: person.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      await onSaved(result, person.id ? person : { ...person, username: body.username });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function resetPassword() {
    if (!confirm(`Reset the password for ${person.name}? Their sessions will be signed out.`)) return;
    setBusy(true); setError('');
    try { const result = await api('/users/' + person.id, { method: 'PATCH', body: JSON.stringify({ resetPassword: true }) }); await onSaved(result, person); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor-dialog person-dialog" aria-labelledby="person-editor-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <header><div><h2 id="person-editor-title">{person.id ? person.name : 'Add person'}</h2>{person.id && <p className="muted">@{person.username}</p>}</div><button className="icon-button" disabled={busy} aria-label="Close person details" onClick={onClose}><X size={20}/></button></header>
    <form onSubmit={save}>
      <fieldset className="person-fields" disabled={busy}>
        {!person.id && <div className="form-grid"><label>Full name<input name="name" required maxLength={100} autoComplete="off"/></label><label>Username<input name="username" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" maxLength={64} autoComplete="off"/></label></div>}
        <div className="form-grid"><label>Email<input name="email" type="email" defaultValue={person.email || ''} maxLength={254} placeholder="Optional"/></label><label>Role<select name="role" defaultValue={person.role}><option value="member">Member</option><option value="admin">Administrator</option></select></label></div>
        <label>Departments<select value="" onChange={e => { if (e.target.value === '__create__') { setCreating(true); setNotice(''); } else if (e.target.value) setIds(previous => [...previous, e.target.value]); }}><option value="">Select a department</option>{departments.filter(d => !ids.includes(d.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}<option value="__create__">+ Create department</option></select></label>
        {ids.length > 0 && <div className="selected-departments">{ids.map(id => <span key={id}>{departments.find(d => d.id === id)?.name || 'Department'}<button type="button" className="icon-button" aria-label={'Remove ' + (departments.find(d => d.id === id)?.name || 'department')} onClick={() => setIds(previous => previous.filter(value => value !== id))}><X size={13}/></button></span>)}</div>}
        {creating && <div className="create-department-inline"><label>Department name<input value={departmentName} maxLength={80} onChange={e => setDepartmentName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createDepartment(); } }} autoFocus placeholder="e.g. Operations"/></label><div className="actions"><button type="button" className="button small" disabled={!departmentName.trim()} onClick={createDepartment}>Create department</button><button type="button" className="text-button" onClick={() => setCreating(false)}>Cancel</button></div></div>}
      </fieldset>
      {notice && <p className="small-copy muted" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="person-dialog-actions"><button className="button small" disabled={busy || creating}>{busy ? 'Saving…' : person.id ? 'Save changes' : 'Create account'}</button><button type="button" className="button small outline" disabled={busy} onClick={onClose}>Cancel</button></footer>
    </form>
    {person.id && person.localAccount && authMode && authMode !== 'oidc' && <div className="person-password"><button className="text-button" disabled={busy} onClick={resetPassword}><KeyRound size={15}/>Reset password</button></div>}
    <details className="department-management"><summary>Manage departments</summary><DepartmentPanel departments={departments} onChange={refreshDepartments} disabled={busy} onBusyChange={setBusy}/></details>
  </dialog>;
}
