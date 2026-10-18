'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, X, ThumbsUp, ThumbsDown, RefreshCw, Copy, Check, Search, Files, Users, Upload, Eye, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import DocumentIndex from './document-index';

function Heading({ title, text, children }) {
  return <div className="panel-heading"><div><h1>{title}</h1>{text&&<p>{text}</p>}</div>{children}</div>;
}
export function DepartmentPicker({ departments, value, onChange, disabled = false }) {
  return <fieldset className="department-picker"><legend>Departments</legend>{!departments.length && <p className="muted">Create a department first.</p>}{departments.map(d => <label key={d.id}><input type="checkbox" disabled={disabled} checked={value.includes(d.id)} onChange={e => onChange(e.target.checked ? [...value, d.id] : value.filter(id => id !== d.id))}/>{d.name}</label>)}</fieldset>;
}
export function DepartmentPanel({ departments, onChange, disabled = false, onBusyChange }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function mutate(path, method, body) {
    setBusy(true); onBusyChange?.(true); setError('');
    try { await api(path,{method,body:body ? JSON.stringify(body):undefined}); await onChange(); return true; }
    catch(e) { setError(e.message); return false; }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <aside className="department-editor-list" aria-label="Manage departments">
    {error && <p className="error" role="alert">{error}</p>}
    <div className="admin-list">{departments.map(d=><form key={d.id} className="department-row" onSubmit={e=>{e.preventDefault();mutate('/departments/'+d.id,'PATCH',{name:new FormData(e.currentTarget).get('name')});}}><input aria-label={'Name for '+d.name} name="name" defaultValue={d.name} required maxLength={80} disabled={busy || disabled}/><div className="actions"><button className="text-button" disabled={busy || disabled}>Save name</button><button type="button" className="text-button danger" disabled={busy || disabled} onClick={()=>{if(confirm('Delete '+d.name+'? Its memberships will be removed. Department-only documents with no remaining departments will be inaccessible.'))mutate('/departments/'+d.id,'DELETE');}}>Delete</button></div></form>)}</div>
    {!departments.length && <p className="muted small-copy department-empty">No departments yet. Use the dropdown above to create one.</p>}
  </aside>;
}
export function DocumentManager({ health, onUpdate, onSource }) {
  const [notice,setNotice]=useState(''); const [data,setData]=useState(null); const [page,setPage]=useState(1);
  const [departments,setDepartments]=useState([]); const [editing,setEditing]=useState(null); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState(''); const [filter,setFilter]=useState('all'); const [readable,setReadable]=useState(new Set());
  async function load() {
    try { setData(await api('/admin/documents?page='+page)); setError(''); }
    catch(e) { setError(e.message); }
  }
  async function loadReadable() {
    try { setReadable(new Set((await api('/documents')).map(d=>d.id))); }
    catch(e) { setError(e.message); }
  }
  useEffect(()=>{load();loadReadable();},[page]);
  useEffect(()=>{api('/departments').then(setDepartments).catch(e=>setError(e.message));},[]);
  async function refresh() { await Promise.all([load(),loadReadable(),onUpdate()]); }
  async function edit(id){setBusy(true);setError('');try{setEditing(await api('/admin/documents/'+id));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function remove(d){if(!confirm('Delete “'+d.title+'”? It will no longer be available for new answers.'))return;setBusy(true);try{await api('/documents/'+d.id,{method:'DELETE'});await refresh();setNotice('Document deleted. It is no longer available for new answers.');}catch(e){setError(e.message);}finally{setBusy(false);}}
  function add(mode) { setEditing({title:'',category:'General',version:'1',visibility:'admins',departments:[],content_text:'',source_kind:'managed',initialMode:mode}); }
  const items=(data?.items||[]).filter(d=>d.title.toLowerCase().includes(search.toLowerCase())&&(filter==='all'||(filter==='pending'?d.needs_index:!d.needs_index&&d.chunks>0)));
  const pending=data?.items.filter(d=>d.needs_index).length||0;
  return <section className="panel knowledge-panel"><Heading title="Documents"><div className="actions"><button className="button small outline" disabled={busy} onClick={()=>add('text')}><Plus size={16}/>Paste text</button><button className="button small" disabled={busy} onClick={()=>add('file')}><Upload size={16}/>Upload document</button></div></Heading>
    <DocumentIndex health={health} onChange={refresh}/>
    {notice&&<p className="success-notice dismissible" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={15}/></button></p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="library-surface">
      <div className="library-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Search documents on this page" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this page…"/></div><label className="filter-field"><span>Show</span><select aria-label="Filter documents on this page" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All documents</option><option value="ready">Indexed</option><option value="pending">Needs indexing</option></select></label></div>
      {pending>0&&<p className="library-hint"><span className="status warning"><i/></span>{pending} document{pending===1?'':'s'} on this page need{pending===1?'s':''} indexing. Rebuild above to publish changes.</p>}
      {data ? <><div className="table-wrap document-table"><table><thead><tr><th>Document</th><th>Access</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map(d=><tr key={d.id}><td><div className="document-identity"><span className="file-mark"><FileText size={21}/></span><div><strong>{d.title}</strong><small className="block muted">{d.category} · v{d.version} · {d.source_kind==='folder'?'Folder':'Uploaded or pasted'}</small></div></div></td><td><span className="access-label">{d.visibility==='admins'?'Administrators':d.visibility==='everyone'?'Everyone':d.departments.map(id=>departments.find(x=>x.id===id)?.name||'Department').join(', ')||'No departments'}</span></td><td><span className={'tag '+(d.needs_index?'pending':'')}>{d.needs_index?'Needs indexing':d.chunks>0?'Indexed':'Not indexed'}</span>{!d.needs_index&&d.chunks>0&&<small className="block muted">{d.chunks} sections</small>}</td><td><div className="actions"><button className="icon-button" title={readable.has(d.id)?'Read document':'No published document available to your account'} aria-label={'Read '+d.title} disabled={!readable.has(d.id)} onClick={()=>onSource({documentId:d.id,title:d.title})}><Eye size={17}/></button><button className="icon-button" title="Edit document and access" aria-label={'Edit '+d.title} disabled={busy} onClick={()=>edit(d.id)}><Pencil size={16}/></button><button className="text-button danger" disabled={busy} onClick={()=>remove(d)}>Delete</button></div></td></tr>)}</tbody></table></div>
      {!items.length&&<div className="library-empty"><Files size={30}/><h3>{data.items.length?'No matching documents':'No documents yet'}</h3><p>{data.items.length?'Try another title or change the filter.':'Upload a policy, paste a guide, or rebuild to import your configured folder.'}</p>{!data.items.length&&<button className="button small outline" onClick={()=>add('file')}><Upload size={15}/>Upload your first document</button>}</div>}
      <Pager page={page} hasMore={data.hasMore} onChange={next=>{setData(null);setPage(next);}}/></>:!error&&<p className="muted library-loading">Loading documents…</p>}
    </div>
    {editing&&<DocumentEditor document={editing} departments={departments} onClose={()=>setEditing(null)} onSaved={async()=>{setEditing(null);await refresh();setNotice('Document saved. Rebuild the index to make its latest content searchable.');}}/>}
  </section>;
}
function DocumentEditor({document,departments,onClose,onSaved}) {
  const [access,setAccess]=useState(document.visibility);const [ids,setIds]=useState(document.departments);const [mode,setMode]=useState(document.initialMode||'text');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dialog=useRef(null);
  useEffect(()=>{dialog.current.showModal();},[]);
  async function save(e){e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);const values={title:form.get('title'),category:form.get('category'),version:form.get('version'),visibility:access,departments:access==='departments'?ids:[]};try{
    if(!document.id && mode==='file'){if(form.get('file').size>10*1024*1024)throw new Error('Choose a file no larger than 10 MB.');const upload=new FormData();Object.entries(values).forEach(([k,v])=>upload.set(k,Array.isArray(v)?JSON.stringify(v):v));upload.set('file',form.get('file'));await api('/documents/upload',{method:'POST',body:upload});}
    else {if(document.source_kind==='managed')values.content=form.get('content');await api('/documents'+(document.id?'/'+document.id:''),{method:document.id?'PATCH':'POST',body:JSON.stringify(values)});}
    await onSaved();
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="editor-dialog" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><header><div><h2>{document.id?'Edit document':'Add a document'}</h2></div><button className="icon-button" disabled={busy} aria-label="Close editor" onClick={onClose}><X/></button></header><form onSubmit={save}><div className="form-grid"><label>Title<input name="title" defaultValue={document.title} required maxLength={200}/></label><label>Category<input name="category" defaultValue={document.category} required maxLength={80}/></label><label>Version<input name="version" defaultValue={document.version} required maxLength={50}/></label><label>Who can read this?<select value={access} onChange={e=>setAccess(e.target.value)}><option value="admins">Administrators only</option><option value="everyone">Everyone signed in</option><option value="departments">Selected departments</option></select></label></div>{access==='departments'&&<DepartmentPicker departments={departments} value={ids} onChange={setIds}/>}
    {!document.id&&<div className="actions"><button type="button" className={'button small '+(mode==='text'?'':'outline')} onClick={()=>setMode('text')}>Paste text</button><button type="button" className={'button small '+(mode==='file'?'':'outline')} onClick={()=>setMode('file')}>Upload a file</button></div>}
    {document.source_kind==='folder'?<p className="muted">Edit this file in your configured source folder, then rebuild. Its access and labels can be changed here.</p>:mode==='file'?<label>Markdown, text, PDF, or Word · up to 10 MB<input name="file" type="file" accept=".md,.txt,.pdf,.docx" required/></label>:<label>Document content<textarea name="content" defaultValue={document.content_text||''} rows={12} maxLength={2000000} required placeholder="# Your policy&#10;&#10;Paste the document here…"/></label>}
    {error&&<p className="error" role="alert">{error}</p>}<footer className="actions"><button className="button small" disabled={busy||access==='departments'&&!ids.length}>{busy?'Saving…':'Save document'}</button><button type="button" className="button small outline" disabled={busy} onClick={onClose}>Cancel</button></footer></form></dialog>;
}
export function Feedback({auditId}) {
  const [value,setValue]=useState(null); const [comment,setComment]=useState('');
  const [savedComment,setSavedComment]=useState(''); const [error,setError]=useState('');
  const [busy,setBusy]=useState(false); const [noteSent,setNoteSent]=useState(false);
  const pending=useRef(false);
  async function send(helpful, note=false) {
    if(pending.current)return;
    pending.current=true; setBusy(true); setError('');
    const submitted=note?comment.trim():savedComment;
    try {
      await api('/feedback',{method:'POST',signal:AbortSignal.timeout(15000),body:JSON.stringify({auditId,helpful,comment:submitted})});
      setValue(helpful); setSavedComment(submitted); if(note)setNoteSent(true);
    } catch(e) { setError(e.name==='TimeoutError'||e.name==='AbortError'?'Sending took too long. Your note is kept here; you can retry.':e.message); }
    finally {pending.current=false;setBusy(false);}
  }
  const unchanged=comment.trim()===savedComment;
  return <div className="feedback"><span>Was this helpful?</span>
    <button className="icon-button" aria-label="Helpful" aria-pressed={value===true} disabled={busy} onClick={()=>send(true)}><ThumbsUp size={15}/></button>
    <button className="icon-button" aria-label="Not helpful" aria-pressed={value===false} disabled={busy} onClick={()=>send(false)}><ThumbsDown size={15}/></button>
    {value!==null&&<small role="status">Rating saved.</small>}
    {value===false&&<form onSubmit={e=>{e.preventDefault();send(false,true);}}>
      <input aria-label="Optional feedback" placeholder="What could be better? (optional)" value={comment} maxLength={1000} onChange={e=>{setComment(e.target.value);setNoteSent(false);}}/>
      <button className="text-button" disabled={busy||!comment.trim()||(noteSent&&unchanged)}>{busy?'Sending…':noteSent&&unchanged?'Note sent':'Send note'}</button>
      {noteSent&&unchanged&&<small role="status">Your note was sent to the administrator.</small>}
    </form>}
    {error&&<small className="error" role="alert">{error}</small>}
  </div>;
}
export function AuditPanel() {
  const [page,setPage]=useState(1);const [data,setData]=useState(null);const [error,setError]=useState('');
  const load=()=>api('/audit?page='+page).then(setData).catch(e=>setError(e.message));useEffect(()=>{load();},[page]);
  return <section className="panel"><Heading title="Answer activity" text="Questions, source evidence, outcomes, and feedback — stored on your server."><button className="button small outline" onClick={load}><RefreshCw size={15}/>Refresh</button></Heading>{error&&<p className="error" role="alert">{error}</p>}{data?<><div className="audit-list">{data.items.map(a=><details className="audit-item" key={a.id}><summary><span className={'tag '+(a.outcome==='failed'?'pending':'')}>{a.outcome}</span><strong>{a.question}</strong><span className="audit-feedback-flags">{a.helpful===false&&<span className="tag feedback-negative"><ThumbsDown size={12}/>Not helpful</span>}{a.helpful===true&&<span className="tag"><ThumbsUp size={12}/>Helpful</span>}{a.comment?.trim()&&<span className="tag feedback-note">Note received</span>}</span><small>{a.user_name||'Deleted user'} · {new Date(a.created_at).toLocaleString()}</small></summary><div className="audit-detail"><p className="preserve">{a.answer_text||'No completed answer text.'}</p><small>{a.model_called?'Chat model called':'No chat generation'} · {a.duration_ms==null?'In progress':(a.duration_ms/1000).toFixed(1)+'s'}{a.helpful!=null?' · '+(a.helpful?'Helpful':'Not helpful'):''}</small>{a.comment&&<blockquote>{a.comment}</blockquote>}{a.sources.map(s=><details key={s.id}><summary>{s.answerCitation===null?'Considered source':`[${s.answerCitation??s.citation}]`} {s.title} · {s.section} · Revision {s.revision}</summary><pre>{s.excerpt}</pre></details>)}</div></details>)}</div>{!data.items.length&&<p className="muted">Completed and interrupted questions will appear here.</p>}<Pager page={page} hasMore={data.hasMore} onChange={setPage}/></>:<p>Loading activity…</p>}</section>;
}
export function EmbedPanel({ inline = false }) {
  const [origin,setOrigin]=useState('');const [copied,setCopied]=useState(false);useEffect(()=>setOrigin(window.location.origin),[]);
  const snippet='<script src="'+origin+'/widget.js" data-groundwork-title="Ask Groundwork" defer></script>';
  return <section className={inline?"embed-settings":"panel"}><Heading title="Embed chat" text="Optional: add an Ask Groundwork button to a website your team already uses."/><div className="settings-card embed-card"><h3>Your embed code</h3><p>Paste this code into your intranet or portal. The button opens Groundwork chat in a separate window, with the same sign-in and document permissions. You do not need this if your team opens Groundwork directly.</p><pre>{snippet}</pre><button className="button small" onClick={async()=>{try{await navigator.clipboard.writeText(snippet);setCopied(true);}catch{setCopied(false);}}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy embed code'}</button><p className="muted">For a same-origin embedded panel, use an iframe pointing to <code>/widget</code>. Cross-origin portals use the launcher so third-party cookies are not required.</p></div></section>;
}
function Pager({page,hasMore,onChange}) { return <div className="pager"><button className="text-button" disabled={page===1} onClick={()=>onChange(page-1)}>Previous</button><span>Page {page}</span><button className="text-button" disabled={!hasMore} onClick={()=>onChange(page+1)}>Next</button></div>; }

